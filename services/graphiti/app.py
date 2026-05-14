from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from config import load_settings
from graphiti_engine import EngineNotReadyError, create_graphiti_engine

app = FastAPI(title="Project Context Graphiti HTTP Contract", version="0.1.0")
SETTINGS = load_settings()
ENGINE = create_graphiti_engine(SETTINGS)


class MemoryPayload(BaseModel):
    project_id: str
    id: str | None = None
    topic: str = ""
    status: str = "current"
    payload: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class FactsRequest(BaseModel):
    project_id: str
    topic: str = ""
    related_requirement_id: str | None = None


class HistoryRequest(BaseModel):
    project_id: str
    topic: str = ""
    include_deprecated: bool = False


@app.on_event("startup")
async def startup() -> None:
    await ENGINE.startup()


@app.on_event("shutdown")
async def shutdown() -> None:
    await ENGINE.shutdown()


@app.get("/health")
async def health() -> dict[str, Any]:
    return await ENGINE.health()


@app.post("/v1/memory/decisions")
async def remember_decision(payload: MemoryPayload, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(payload.project_id, x_project_id)
    return await call_engine(payload.project_id, ENGINE.remember_event("decision", payload.model_dump()))


@app.post("/v1/memory/reviews")
async def remember_review(payload: MemoryPayload, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(payload.project_id, x_project_id)
    return await call_engine(payload.project_id, ENGINE.remember_event("review_finding", payload.model_dump()))


@app.post("/v1/memory/requirement-changes")
async def remember_requirement_change(payload: MemoryPayload, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(payload.project_id, x_project_id)
    if payload.id and not payload.id.startswith("REQCHG-"):
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "Requirement change IDs must use REQCHG-*.", "project_id": payload.project_id})
    return await call_engine(payload.project_id, ENGINE.remember_event("requirement_change", payload.model_dump()))


@app.post("/v1/memory/implementation-summaries")
async def remember_implementation_summary(payload: MemoryPayload, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(payload.project_id, x_project_id)
    return await call_engine(payload.project_id, ENGINE.remember_event("implementation_summary", payload.model_dump()))


@app.post("/v1/approvals")
async def remember_approval(payload: MemoryPayload, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(payload.project_id, x_project_id)
    return await call_engine(payload.project_id, ENGINE.remember_event("approval", payload.model_dump()))


@app.post("/v1/facts/current")
async def current_facts(request: FactsRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    facts = await call_engine(request.project_id, ENGINE.get_current_facts(request.project_id, request.topic, request.related_requirement_id))
    return {"facts": facts}


@app.post("/v1/history")
async def history(request: HistoryRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    events = await call_engine(request.project_id, ENGINE.get_history(request.project_id, request.topic, request.include_deprecated))
    return {"events": events}


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
                "message": "Graphiti backend request failed.",
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
