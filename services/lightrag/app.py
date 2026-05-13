from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Project Context LightRAG HTTP Contract", version="0.1.0")
DATA_DIR = Path(os.environ.get("LIGHTRAG_DATA_DIR", "/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)


class IngestRequest(BaseModel):
    project_id: str
    paths: list[str]
    mode: str
    documents: list["IngestDocument"] = Field(default_factory=list)


class IngestDocument(BaseModel):
    path: str
    content: str
    stable_ids: list[str] = Field(default_factory=list)
    heading: str | None = None


class SearchRequest(BaseModel):
    project_id: str
    query: str = ""
    limit: int = 10
    document_types: list[str] | None = None


class SpecRequest(BaseModel):
    project_id: str
    spec_id: str
    include_neighbors: bool = False


class RelatedCodeRequest(BaseModel):
    project_id: str
    query: str = ""
    limit: int = 10


class RequirementSourcesRequest(BaseModel):
    project_id: str
    requirement_id: str


class DocumentRequest(BaseModel):
    project_id: str
    chunk_id: str | None = None
    source_path: str | None = None


class Chunk(BaseModel):
    project_id: str
    chunk_id: str
    source_path: str
    heading: str | None = None
    stable_ids: list[str] = Field(default_factory=list)
    content: str
    document_type: str = "doc"
    domain: str = "lightrag"
    status: str = "current"
    stale_reason: str | None = None
    created_at: str
    updated_at: str


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "engine": "lightrag", "contract": "pcp-v1"}


@app.post("/v1/ingest")
def ingest(request: IngestRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    # The TS layer sends workspace-relative paths. This contract sidecar stores
    # index bookkeeping per project; production deployments can swap this file
    # path loader for native LightRAG server ingestion without changing TS.
    chunks = load_chunks(request.project_id)
    now = iso_now()
    warnings: list[str] = []
    documents_by_path = {document.path: document for document in request.documents}
    for source_path in request.paths:
        document = documents_by_path.get(source_path)
        chunks = [chunk for chunk in chunks if chunk.source_path != source_path]
        chunks.append(Chunk(
            project_id=request.project_id,
            chunk_id=str(uuid.uuid4()),
            source_path=source_path,
            heading=document.heading if document else None,
            stable_ids=document.stable_ids if document else [],
            content=document.content if document else f"Indexed by LightRAG sidecar contract: {source_path}",
            document_type=document_type(source_path),
            created_at=now,
            updated_at=now,
        ))
    save_chunks(request.project_id, chunks)
    return {"indexed": len(request.paths), "warnings": warnings}


@app.post("/v1/search")
def search(request: SearchRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    terms = [term.lower() for term in re.split(r"\W+", request.query) if term]
    chunks = load_chunks(request.project_id)
    if request.document_types:
        allowed_types = set(request.document_types)
        chunks = [chunk for chunk in chunks if chunk.document_type in allowed_types]
    ranked = sorted(
        chunks,
        key=lambda chunk: score(chunk, terms),
        reverse=True,
    )
    return {"chunks": [chunk.model_dump() for chunk in ranked if score(chunk, terms) > 0 or not terms][: request.limit]}


@app.post("/v1/spec-context")
def spec_context(request: SpecRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    chunks = load_chunks(request.project_id)
    matches = [chunk for chunk in chunks if request.spec_id in chunk.source_path or request.spec_id in chunk.stable_ids]
    if request.include_neighbors:
        paths = {chunk.source_path for chunk in matches}
        matches = [chunk for chunk in chunks if chunk.source_path in paths]
    return {"chunks": [chunk.model_dump() for chunk in matches]}


@app.post("/v1/related-code")
def related_code(request: RelatedCodeRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    terms = [term.lower() for term in re.split(r"\W+", request.query) if term]
    chunks = [chunk for chunk in load_chunks(request.project_id) if chunk.document_type in {"code", "test"}]
    ranked = sorted(chunks, key=lambda chunk: score(chunk, terms), reverse=True)
    return {"chunks": [chunk.model_dump() for chunk in ranked if score(chunk, terms) > 0 or not terms][: request.limit]}


@app.post("/v1/requirement-sources")
def requirement_sources(request: RequirementSourcesRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    chunks = [chunk for chunk in load_chunks(request.project_id) if request.requirement_id in chunk.stable_ids]
    return {"chunks": [chunk.model_dump() for chunk in chunks]}


@app.post("/v1/document")
def document(request: DocumentRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    if not request.chunk_id and not request.source_path:
        return {"chunks": []}
    chunks = load_chunks(request.project_id)
    if request.chunk_id:
        matches = [chunk for chunk in chunks if chunk.chunk_id == request.chunk_id]
    else:
        matches = [chunk for chunk in chunks if chunk.source_path == request.source_path]
    return {"chunks": [chunk.model_dump() for chunk in sorted(matches, key=lambda item: item.source_path)]}


@app.delete("/v1/projects/{project_id}")
def delete_project(project_id: str, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(project_id, x_project_id)
    path = project_file(project_id)
    had_file = path.exists()
    if had_file:
        path.unlink()
    return {"ok": True, "project_id": project_id, "deleted": had_file}


def assert_project_header(project_id: str, header: str | None) -> None:
    if header and header != project_id:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "Project header does not match payload.", "project_id": project_id})


def project_file(project_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "-", project_id)
    return DATA_DIR / f"{safe}-chunks.json"


def load_chunks(project_id: str) -> list[Chunk]:
    path = project_file(project_id)
    if not path.exists():
        return []
    return [Chunk(**item) for item in json.loads(path.read_text())]


def save_chunks(project_id: str, chunks: list[Chunk]) -> None:
    project_file(project_id).write_text(json.dumps([chunk.model_dump() for chunk in chunks], indent=2))


def score(chunk: Chunk, terms: list[str]) -> int:
    haystack = f"{chunk.source_path}\n{chunk.heading or ''}\n{chunk.content}".lower()
    return sum(1 for term in terms if term in haystack)


def document_type(path: str) -> str:
    lower = path.lower()
    if "test" in lower:
        return "test"
    if lower.endswith((".ts", ".tsx", ".js", ".jsx", ".php", ".blade.php", ".py", ".go")):
        return "code"
    if "srs" in lower:
        return "srs"
    if "prd" in lower:
        return "prd"
    return "doc"


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()
