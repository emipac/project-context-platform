from __future__ import annotations

import asyncio
import inspect
import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

from config import GraphitiSettings, validate_core_ready


class EngineNotReadyError(Exception):
    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.details = details or {}


class GraphitiEngine(Protocol):
    async def startup(self) -> None: ...
    async def shutdown(self) -> None: ...
    async def health(self) -> dict[str, Any]: ...
    async def remember_event(self, event_type: str, payload: dict[str, Any]) -> dict[str, Any]: ...
    async def get_current_facts(self, project_id: str, topic: str, related_requirement_id: str | None = None) -> list[dict[str, Any]]: ...
    async def get_history(self, project_id: str, topic: str, include_deprecated: bool) -> list[dict[str, Any]]: ...
    async def delete_project(self, project_id: str) -> dict[str, Any]: ...


@dataclass(frozen=True)
class ProjectNamespace:
    project_id: str
    safe_project_id: str
    events_file: Path


def create_graphiti_engine(settings: GraphitiSettings) -> GraphitiEngine:
    if settings.backend == "core":
        return CoreGraphitiEngine(settings)
    return ContractGraphitiEngine(settings)


class AuditLedger:
    def __init__(self, settings: GraphitiSettings):
        self.settings = settings
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)

    def namespace(self, project_id: str) -> ProjectNamespace:
        safe = re.sub(r"[^a-zA-Z0-9_-]", "-", project_id)
        return ProjectNamespace(project_id=project_id, safe_project_id=safe, events_file=self.settings.data_dir / f"{safe}-events.json")

    def load(self, project_id: str) -> list[dict[str, Any]]:
        path = self.namespace(project_id).events_file
        if not path.exists():
            return []
        return json.loads(path.read_text())

    def save(self, project_id: str, events: list[dict[str, Any]]) -> None:
        self.namespace(project_id).events_file.write_text(json.dumps(events, indent=2))

    def append(self, event: dict[str, Any]) -> dict[str, Any]:
        events = self.load(str(event["project_id"]))
        events.append(event)
        self.save(str(event["project_id"]), events)
        return event

    def update_status(self, project_id: str, event_uuid: str, graph_status: str, graph_error: str | None = None) -> None:
        events = self.load(project_id)
        next_events: list[dict[str, Any]] = []
        for event in events:
            if event.get("event_uuid") == event_uuid:
                event = {**event, "graph_ingestion_status": graph_status, "graph_error": graph_error}
            next_events.append(event)
        self.save(project_id, next_events)

    def delete(self, project_id: str) -> bool:
        path = self.namespace(project_id).events_file
        had_file = path.exists()
        if had_file:
            path.unlink()
        return had_file

    def migration_available(self) -> bool:
        return any(self.settings.data_dir.glob("*-events.json"))


class ContractGraphitiEngine:
    def __init__(self, settings: GraphitiSettings):
        self.settings = settings
        self.audit = AuditLedger(settings)

    async def startup(self) -> None:
        return None

    async def shutdown(self) -> None:
        return None

    async def health(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "engine": "graphiti",
            "contract": "pcp-v1",
            "backend": "contract",
            "llm_configured": bool(self.settings.openai_api_key) if self.settings.llm_provider in {"openai", "openai-compatible"} else True,
            "embedding_configured": bool(self.settings.embedding_model),
            "storage_ready": self.settings.data_dir.exists() and self.settings.data_dir.is_dir(),
            "graph_ready": True,
            "migration_available": self.audit.migration_available(),
            "core_implemented": False,
            "missing_configuration": [],
        }

    async def remember_event(self, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        event = normalize_event(event_type, payload)
        self.audit.append(event)
        return {"ok": True}

    async def get_current_facts(self, project_id: str, topic: str, related_requirement_id: str | None = None) -> list[dict[str, Any]]:
        facts = [
            event for event in self.audit.load(project_id)
            if topic_matches(event, topic) and event.get("status") != "deprecated"
        ]
        if related_requirement_id:
            facts = [event for event in facts if related_requirement_id in related_requirements(event)]
        return facts

    async def get_history(self, project_id: str, topic: str, include_deprecated: bool) -> list[dict[str, Any]]:
        return [
            event for event in self.audit.load(project_id)
            if topic_matches(event, topic) and (include_deprecated or event.get("status") != "deprecated")
        ]

    async def delete_project(self, project_id: str) -> dict[str, Any]:
        deleted_events = self.audit.delete(project_id)
        return {"ok": True, "project_id": project_id, "deleted_events": deleted_events, "deleted_graph": False}


class CoreGraphitiEngine:
    def __init__(self, settings: GraphitiSettings):
        self.settings = settings
        self.audit = AuditLedger(settings)
        self.graphiti: Any | None = None
        self.semaphore = asyncio.Semaphore(settings.concurrency_limit)
        self.graph_ready = False
        self.startup_error: str | None = None

    async def startup(self) -> None:
        missing = validate_core_ready(self.settings)
        if missing:
            self.startup_error = f"Missing configuration: {', '.join(missing)}"
            return
        try:
            self.graphiti = self._build_graphiti()
            await maybe_await(self.graphiti.build_indices_and_constraints())
            self.graph_ready = True
            self.startup_error = None
        except Exception as err:
            self.graph_ready = False
            self.startup_error = safe_error(err)

    async def shutdown(self) -> None:
        if self.graphiti is not None:
            await maybe_await(self.graphiti.close())

    async def health(self) -> dict[str, Any]:
        missing = validate_core_ready(self.settings)
        dependency_ready = self._dependencies_ready()
        ready = not missing and dependency_ready and self.graph_ready
        return {
            "status": "ok" if ready else "degraded",
            "engine": "graphiti",
            "contract": "pcp-v1",
            "backend": "core",
            "llm_configured": bool(self.settings.openai_api_key) if self.settings.llm_provider in {"openai", "openai-compatible"} else True,
            "embedding_configured": bool(self.settings.embedding_model),
            "storage_ready": self.settings.data_dir.exists() and self.settings.data_dir.is_dir(),
            "graph_ready": self.graph_ready,
            "migration_available": self.audit.migration_available(),
            "core_implemented": True,
            "dependency_ready": dependency_ready,
            "missing_configuration": missing,
            "startup_error": self.startup_error,
        }

    async def remember_event(self, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._assert_ready()
        event = normalize_event(event_type, payload, graph_ingestion_status="pending")
        self.audit.append(event)
        try:
            async with self.semaphore:
                await self._add_episode(event_type, event)
            self.audit.update_status(str(event["project_id"]), str(event["event_uuid"]), "succeeded")
        except Exception as err:
            self.audit.update_status(str(event["project_id"]), str(event["event_uuid"]), "failed", safe_error(err))
            raise
        return {"ok": True}

    async def get_current_facts(self, project_id: str, topic: str, related_requirement_id: str | None = None) -> list[dict[str, Any]]:
        self._assert_ready()
        results = await self._search(project_id, topic or project_id)
        facts = [serialize_graphiti_result(item, project_id) for item in results]
        facts = [fact for fact in facts if fact.get("status") != "deprecated"]
        if related_requirement_id:
            audit_matches = [
                event for event in self.audit.load(project_id)
                if related_requirement_id in related_requirements(event) and event.get("status") != "deprecated" and topic_matches(event, topic)
            ]
            facts.extend(audit_matches)
        return dedupe_records(facts)

    async def get_history(self, project_id: str, topic: str, include_deprecated: bool) -> list[dict[str, Any]]:
        events = [
            event for event in self.audit.load(project_id)
            if topic_matches(event, topic) and (include_deprecated or event.get("status") != "deprecated")
        ]
        if topic:
            try:
                graph_matches = [serialize_graphiti_result(item, project_id) for item in await self._search(project_id, topic)]
                if graph_matches:
                    events.append({
                        "project_id": project_id,
                        "type": "graphiti_search_context",
                        "topic": topic,
                        "status": "current",
                        "created_at": iso_now(),
                        "graphiti_namespace": project_id,
                        "matches": graph_matches,
                    })
            except Exception:
                pass
        return events

    async def delete_project(self, project_id: str) -> dict[str, Any]:
        deleted_events = self.audit.delete(project_id)
        deleted_graph = await self._delete_graph_namespace(project_id)
        return {"ok": True, "project_id": project_id, "deleted_events": deleted_events, "deleted_graph": deleted_graph}

    async def _search(self, project_id: str, query: str) -> list[Any]:
        self._assert_ready()
        try:
            return await maybe_await(self.graphiti.search(query, group_ids=[project_id]))
        except TypeError:
            try:
                return await maybe_await(self.graphiti.search(query, group_id=project_id))
            except TypeError:
                return await maybe_await(self.graphiti.search(query))

    async def _add_episode(self, event_type: str, event: dict[str, Any]) -> None:
        kwargs = {
            "name": f"{event_type}:{event.get('id') or event['event_uuid']}",
            "episode_body": json.dumps(event, default=str),
            "source": self._episode_type_json(),
            "source_description": f"pcp:{event_type}",
            "reference_time": parse_reference_time(str(event["created_at"])),
            "group_id": str(event["project_id"]),
        }
        try:
            await maybe_await(self.graphiti.add_episode(**kwargs))
            return
        except TypeError:
            kwargs.pop("group_id", None)
            await maybe_await(self.graphiti.add_episode(**kwargs))

    def _build_graphiti(self) -> Any:
        from graphiti_core import Graphiti

        graphiti = Graphiti(self.settings.neo4j_uri, self.settings.neo4j_user, self.settings.neo4j_password)
        llm_client = getattr(graphiti, "llm_client", None)
        if llm_client is not None:
            if hasattr(llm_client, "model"):
                llm_client.model = self.settings.llm_model
            if hasattr(llm_client, "small_model"):
                llm_client.small_model = self.settings.small_llm_model
        return graphiti

    def _episode_type_json(self) -> Any:
        from graphiti_core.nodes import EpisodeType

        return EpisodeType.json

    async def _delete_graph_namespace(self, project_id: str) -> bool:
        if not self.settings.neo4j_uri or not self.settings.neo4j_user or not self.settings.neo4j_password:
            return False
        try:
            from neo4j import GraphDatabase
        except ImportError:
            return False
        driver = None
        try:
            driver = GraphDatabase.driver(self.settings.neo4j_uri, auth=(self.settings.neo4j_user, self.settings.neo4j_password))
            with driver.session() as session:
                session.run("MATCH ()-[r]->() WHERE r.group_id = $pid DELETE r", pid=project_id)
                session.run("MATCH (n) WHERE n.group_id = $pid DETACH DELETE n", pid=project_id)
            return True
        except Exception:
            return False
        finally:
            if driver is not None:
                driver.close()

    def _dependencies_ready(self) -> bool:
        try:
            import graphiti_core  # noqa: F401
            import neo4j  # noqa: F401
        except ImportError:
            return False
        return True

    def _assert_ready(self) -> None:
        missing = validate_core_ready(self.settings)
        if missing:
            raise EngineNotReadyError("Graphiti core backend is missing required configuration.", {"missing_configuration": missing})
        if not self._dependencies_ready():
            raise EngineNotReadyError("Graphiti core dependencies are unavailable.")
        if self.graphiti is None or not self.graph_ready:
            raise EngineNotReadyError("Graphiti core backend is not ready.", {"startup_error": self.startup_error})


def normalize_event(event_type: str, payload: dict[str, Any], graph_ingestion_status: str | None = None) -> dict[str, Any]:
    now = iso_now()
    event = dict(payload)
    event.setdefault("event_uuid", str(uuid.uuid5(uuid.NAMESPACE_URL, json.dumps(event, sort_keys=True, default=str))))
    event.update({
        "type": event_type,
        "created_at": event.get("created_at") or now,
        "graphiti_namespace": event["project_id"],
    })
    if graph_ingestion_status is not None:
        event["graph_ingestion_status"] = graph_ingestion_status
    return event


def topic_matches(event: dict[str, Any], topic: str) -> bool:
    if not topic:
        return True
    return topic.lower() in str(event.get("topic", "")).lower() or topic.lower() in json.dumps(event, default=str).lower()


def related_requirements(event: dict[str, Any]) -> list[str]:
    values: list[Any] = []
    for key in ("related_requirement_id", "related_requirements", "requirements"):
        value = event.get(key)
        if isinstance(value, list):
            values.extend(value)
        elif isinstance(value, str):
            values.append(value)
    payload = event.get("payload")
    if isinstance(payload, dict):
        for key in ("related_requirement_id", "related_requirements", "requirements"):
            value = payload.get(key)
            if isinstance(value, list):
                values.extend(value)
            elif isinstance(value, str):
                values.append(value)
    return [str(value) for value in values]


def serialize_graphiti_result(value: Any, project_id: str) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        data = value.model_dump()
    elif hasattr(value, "dict"):
        data = value.dict()
    elif isinstance(value, dict):
        data = value
    else:
        data = {
            key: getattr(value, key)
            for key in ("uuid", "name", "fact", "valid_at", "invalid_at", "created_at", "expired_at", "episodes", "group_id")
            if hasattr(value, key)
        }
        if not data:
            data = {"value": str(value)}
    data = json_safe(data)
    data.setdefault("project_id", project_id)
    data.setdefault("type", "graphiti_fact")
    data.setdefault("status", "deprecated" if data.get("expired_at") else "current")
    data.setdefault("topic", data.get("name") or data.get("fact") or "")
    data.setdefault("created_at", iso_now())
    data.setdefault("graphiti_namespace", project_id)
    return data


def dedupe_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    output: list[dict[str, Any]] = []
    for record in records:
        key = str(record.get("uuid") or record.get("event_uuid") or json.dumps(record, sort_keys=True, default=str))
        if key in seen:
            continue
        seen.add(key)
        output.append(record)
    return output


def parse_reference_time(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


async def maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def safe_error(err: Exception) -> str:
    return str(err).replace("\n", " ")[:500]


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()
