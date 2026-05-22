from __future__ import annotations

from typing import Any, Literal

from fastapi import FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

from config import LightRagSettings, load_settings
from lightrag_engine import EngineNotReadyError, create_lightrag_engine
from search_budget import validate_search_budget_limits

app = FastAPI(title="Project Context LightRAG HTTP Contract", version="0.1.0")
SETTINGS = load_settings()
ENGINE = create_lightrag_engine(SETTINGS)

QueryModeLiteral = Literal["naive", "local", "hybrid", "mix", "global"]


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
    chunk_id: str | None = None
    chunk_kind: str | None = None
    chunk_index: int | None = None
    chunk_total: int | None = None
    line_start: int | None = None
    line_end: int | None = None
    content_hash: str | None = None


class SearchRequest(BaseModel):
    project_id: str
    query: str = ""
    limit: int = 10
    document_types: list[str] | None = None
    source_path_prefixes: list[str] | None = None
    chunk_kinds: list[str] | None = None
    query_mode: QueryModeLiteral | None = None
    top_k: int | None = None
    chunk_top_k: int | None = None
    max_total_tokens: int | None = None
    timeout_ms: int | None = None


class DocumentIndexRequest(BaseModel):
    project_id: str
    limit: int = 50
    offset: int = 0
    status: Literal["current", "stale", "all"] = "current"
    chunk_kind: Literal["file", "markdown_section", "stable_id_anchor", "markdown_table_row"] | None = None
    order_by: Literal["updated_at", "created_at", "source_path", "chunk_index"] = "updated_at"
    order: Literal["asc", "desc"] = "desc"


class SpecRequest(BaseModel):
    project_id: str
    spec_id: str
    include_neighbors: bool = False


class RelatedCodeRequest(BaseModel):
    project_id: str
    query: str = ""
    limit: int = 10
    document_types: list[str] | None = None
    source_path_prefixes: list[str] | None = None
    chunk_kinds: list[str] | None = None
    query_mode: QueryModeLiteral | None = None
    top_k: int | None = None
    chunk_top_k: int | None = None
    max_total_tokens: int | None = None
    timeout_ms: int | None = None


class RequirementSourcesRequest(BaseModel):
    project_id: str
    requirement_id: str


class DocumentRequest(BaseModel):
    project_id: str
    chunk_id: str | None = None
    source_path: str | None = None


def search_filters(settings: LightRagSettings, req: SearchRequest) -> dict[str, Any]:
    viol = validate_search_budget_limits(
        settings,
        limit=req.limit,
        top_k=req.top_k,
        chunk_top_k=req.chunk_top_k,
        max_total_tokens=req.max_total_tokens,
        timeout_ms=req.timeout_ms,
    )
    if viol:
        raise HTTPException(status_code=400, detail=viol)
    filters: dict[str, Any] = {"limit": req.limit}
    if req.document_types is not None:
        filters["document_types"] = req.document_types
    if req.source_path_prefixes is not None:
        filters["source_path_prefixes"] = req.source_path_prefixes
    if req.chunk_kinds is not None:
        filters["chunk_kinds"] = req.chunk_kinds
    if req.query_mode is not None:
        filters["query_mode"] = req.query_mode
    if req.top_k is not None:
        filters["top_k"] = req.top_k
    if req.chunk_top_k is not None:
        filters["chunk_top_k"] = req.chunk_top_k
    if req.max_total_tokens is not None:
        filters["max_total_tokens"] = req.max_total_tokens
    if req.timeout_ms is not None:
        filters["timeout_ms"] = req.timeout_ms
    return filters


def related_code_filters(settings: LightRagSettings, req: RelatedCodeRequest) -> dict[str, Any]:
    viol = validate_search_budget_limits(
        settings,
        limit=req.limit,
        top_k=req.top_k,
        chunk_top_k=req.chunk_top_k,
        max_total_tokens=req.max_total_tokens,
        timeout_ms=req.timeout_ms,
    )
    if viol:
        raise HTTPException(status_code=400, detail=viol)
    filters: dict[str, Any] = {"limit": req.limit}
    if req.document_types is not None:
        filters["document_types"] = req.document_types
    if req.source_path_prefixes is not None:
        filters["source_path_prefixes"] = req.source_path_prefixes
    if req.chunk_kinds is not None:
        filters["chunk_kinds"] = req.chunk_kinds
    if req.query_mode is not None:
        filters["query_mode"] = req.query_mode
    if req.top_k is not None:
        filters["top_k"] = req.top_k
    if req.chunk_top_k is not None:
        filters["chunk_top_k"] = req.chunk_top_k
    if req.max_total_tokens is not None:
        filters["max_total_tokens"] = req.max_total_tokens
    if req.timeout_ms is not None:
        filters["timeout_ms"] = req.timeout_ms
    return filters


@app.get("/health")
async def health(
    project_id: str | None = Query(default=None),
    deep: bool = Query(default=False),
    x_project_id: str | None = Header(default=None),
) -> dict[str, Any]:
    if project_id:
        assert_project_header(project_id, x_project_id)
    return await ENGINE.health(project_id, deep)


@app.get("/v1/storage/health")
async def storage_health(
    project_id: str | None = Query(default=None),
    deep: bool = Query(default=True),
    x_project_id: str | None = Header(default=None),
) -> dict[str, Any]:
    if project_id:
        assert_project_header(project_id, x_project_id)
    return await call_engine(project_id or "", ENGINE.storage_health(project_id, deep))


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
    filters = search_filters(SETTINGS, request)
    packed = await call_engine(request.project_id, ENGINE.search(request.project_id, request.query, filters))
    return {"chunks": packed["chunks"], "warnings": packed.get("warnings", [])}


@app.post("/v1/documents")
async def documents(request: DocumentIndexRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    return await call_engine(request.project_id, ENGINE.list_documents(request.project_id, request.model_dump()))


@app.post("/v1/spec-context")
async def spec_context(request: SpecRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    chunks = await call_engine(request.project_id, ENGINE.get_spec_context(request.project_id, request.spec_id, request.include_neighbors))
    return {"chunks": chunks}


@app.post("/v1/related-code")
async def related_code(request: RelatedCodeRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    filters = related_code_filters(SETTINGS, request)
    chunks = await call_engine(request.project_id, ENGINE.get_related_code(request.project_id, request.query, filters))
    return {"chunks": chunks, "warnings": []}


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
