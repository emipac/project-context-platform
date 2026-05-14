from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from config import load_settings
from lightrag_engine import EngineNotReadyError, create_lightrag_engine

app = FastAPI(title="Project Context LightRAG HTTP Contract", version="0.1.0")
SETTINGS = load_settings()
ENGINE = create_lightrag_engine(SETTINGS)


@app.on_event("shutdown")
async def _shutdown_lightrag() -> None:
    await ENGINE.shutdown()


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


@app.get("/health")
async def health() -> dict[str, Any]:
    return await ENGINE.health()


@app.post("/v1/ingest")
async def ingest(request: IngestRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    return await call_engine(request.project_id, ENGINE.ingest(
        request.project_id,
        request.paths,
        request.mode,
        [document.model_dump() for document in request.documents],
    ))


@app.post("/v1/search")
async def search(request: SearchRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    chunks = await call_engine(request.project_id, ENGINE.search(
        request.project_id,
        request.query,
        {"limit": request.limit, "document_types": request.document_types},
    ))
    return {"chunks": chunks}


@app.post("/v1/spec-context")
async def spec_context(request: SpecRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    chunks = await call_engine(request.project_id, ENGINE.get_spec_context(request.project_id, request.spec_id, request.include_neighbors))
    return {"chunks": chunks}


@app.post("/v1/related-code")
async def related_code(request: RelatedCodeRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    chunks = await call_engine(request.project_id, ENGINE.get_related_code(request.project_id, request.query, {"limit": request.limit}))
    return {"chunks": chunks}


@app.post("/v1/requirement-sources")
async def requirement_sources(request: RequirementSourcesRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    chunks = await call_engine(request.project_id, ENGINE.get_requirement_sources(request.project_id, request.requirement_id))
    return {"chunks": chunks}


@app.post("/v1/document")
async def document(request: DocumentRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    chunks = await call_engine(request.project_id, ENGINE.get_document(request.project_id, {"chunk_id": request.chunk_id, "source_path": request.source_path}))
    return {"chunks": chunks}


@app.delete("/v1/projects/{project_id}")
async def delete_project(project_id: str, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(project_id, x_project_id)
    return await call_engine(project_id, ENGINE.delete_project(project_id))


async def call_engine(project_id: str, operation: Any) -> Any:
    try:
        return await operation
    except EngineNotReadyError as err:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "BACKEND_NOT_READY",
                "message": str(err),
                "details": err.details,
                "project_id": project_id,
                "retryable": False,
            },
        ) from err
    except Exception as err:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "BACKEND_UNAVAILABLE",
                "message": "LightRAG backend request failed.",
                "details": {"error": safe_error(err)},
                "project_id": project_id,
                "retryable": True,
            },
        ) from err


def assert_project_header(project_id: str, header: str | None) -> None:
    if header and header != project_id:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "Project header does not match payload.", "project_id": project_id})


def safe_error(err: Exception) -> str:
    return str(err).replace("\n", " ")[:500]
