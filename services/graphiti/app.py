from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Project Context Graphiti HTTP Contract", version="0.1.0")
DATA_DIR = Path(os.environ.get("GRAPHITI_DATA_DIR", "/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)


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
async def maybe_initialize_graphiti() -> None:
    if os.environ.get("GRAPHITI_ENABLE_CORE", "false").lower() != "true":
        return
    # Keep graph-database wiring inside Python. The lightweight JSON store below
    # remains available for local smoke tests when LLM credentials are absent.
    from graphiti_core import Graphiti

    graphiti = Graphiti(
        os.environ["NEO4J_URI"],
        os.environ["NEO4J_USER"],
        os.environ["NEO4J_PASSWORD"],
    )
    try:
        await graphiti.build_indices_and_constraints()
    finally:
        await graphiti.close()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "engine": "graphiti",
        "contract": "pcp-v1",
        "core_enabled": os.environ.get("GRAPHITI_ENABLE_CORE", "false").lower() == "true",
    }


@app.post("/v1/memory/decisions")
def remember_decision(payload: MemoryPayload, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    return append_event("decision", payload, x_project_id)


@app.post("/v1/memory/reviews")
def remember_review(payload: MemoryPayload, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    return append_event("review_finding", payload, x_project_id)


@app.post("/v1/memory/requirement-changes")
def remember_requirement_change(payload: MemoryPayload, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    if payload.id and not payload.id.startswith("REQCHG-"):
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "Requirement change IDs must use REQCHG-*.", "project_id": payload.project_id})
    return append_event("requirement_change", payload, x_project_id)


@app.post("/v1/memory/implementation-summaries")
def remember_implementation_summary(payload: MemoryPayload, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    return append_event("implementation_summary", payload, x_project_id)


@app.post("/v1/approvals")
def remember_approval(payload: MemoryPayload, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    return append_event("approval", payload, x_project_id)


@app.post("/v1/facts/current")
def current_facts(request: FactsRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    facts = [
        event for event in load_events(request.project_id)
        if topic_matches(event, request.topic) and event.get("status") != "deprecated"
    ]
    return {"facts": facts}


@app.post("/v1/history")
def history(request: HistoryRequest, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(request.project_id, x_project_id)
    events = [
        event for event in load_events(request.project_id)
        if topic_matches(event, request.topic) and (request.include_deprecated or event.get("status") != "deprecated")
    ]
    return {"events": events}


@app.delete("/v1/projects/{project_id}")
def delete_project(project_id: str, x_project_id: str | None = Header(default=None)) -> dict[str, Any]:
    assert_project_header(project_id, x_project_id)
    path = project_file(project_id)
    had_file = path.exists()
    if had_file:
        path.unlink()
    deleted_graph = delete_neo4j_namespace(project_id)
    return {"ok": True, "project_id": project_id, "deleted_events": had_file, "deleted_graph": deleted_graph}


def delete_neo4j_namespace(project_id: str) -> bool:
    """PCP contract: remove Neo4j nodes tagged with workspace isolation fields when Graphiti core is enabled."""
    if os.environ.get("GRAPHITI_ENABLE_CORE", "false").lower() != "true":
        return False
    uri = os.environ.get("NEO4J_URI")
    user = os.environ.get("NEO4J_USER")
    password = os.environ.get("NEO4J_PASSWORD")
    if not uri or user is None or password is None:
        return False
    try:
        from neo4j import GraphDatabase
    except ImportError:
        return False
    driver = None
    try:
        driver = GraphDatabase.driver(uri, auth=(user, password))
        with driver.session() as session:
            session.run(
                """
                MATCH (n)
                WHERE n.graphiti_namespace = $pid OR n.namespace = $pid OR n.project_id = $pid
                DETACH DELETE n
                """,
                pid=project_id,
            )
        return True
    except Exception:
        return False
    finally:
        if driver is not None:
            driver.close()


def append_event(event_type: str, payload: MemoryPayload, header: str | None) -> dict[str, Any]:
    assert_project_header(payload.project_id, header)
    event = payload.model_dump()
    event.update({"type": event_type, "created_at": iso_now(), "graphiti_namespace": payload.project_id})
    events = load_events(payload.project_id)
    events.append(event)
    project_file(payload.project_id).write_text(json.dumps(events, indent=2))
    return {"ok": True}


def assert_project_header(project_id: str, header: str | None) -> None:
    if header and header != project_id:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "Project header does not match payload.", "project_id": project_id})


def topic_matches(event: dict[str, Any], topic: str) -> bool:
    if not topic:
        return True
    return topic.lower() in str(event.get("topic", "")).lower() or topic.lower() in json.dumps(event).lower()


def project_file(project_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "-", project_id)
    return DATA_DIR / f"{safe}-events.json"


def load_events(project_id: str) -> list[dict[str, Any]]:
    path = project_file(project_id)
    if not path.exists():
        return []
    return json.loads(path.read_text())


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()
