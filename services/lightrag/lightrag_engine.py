from __future__ import annotations

import asyncio
import hashlib
import json
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

import inspect

from config import LightRagSettings, validate_core_ready
from search_ranking import apply_source_diversity_cap


class EngineNotReadyError(Exception):
    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.details = details or {}


class LightRagEngine(Protocol):
    async def health(self, project_id: str | None = None, deep: bool = False) -> dict[str, Any]: ...
    async def storage_health(self, project_id: str | None = None, deep: bool = True) -> dict[str, Any]: ...
    async def ingest(self, project_id: str, paths: list[str], mode: str, documents: list[dict[str, Any]]) -> dict[str, Any]: ...
    async def list_documents(self, project_id: str, filters: dict[str, Any]) -> dict[str, Any]: ...
    async def search(self, project_id: str, query: str, filters: dict[str, Any]) -> dict[str, Any]: ...
    async def get_spec_context(self, project_id: str, spec_id: str, include_neighbors: bool) -> list[dict[str, Any]]: ...
    async def get_related_code(self, project_id: str, query: str, filters: dict[str, Any]) -> list[dict[str, Any]]: ...
    async def get_requirement_sources(self, project_id: str, requirement_id: str) -> list[dict[str, Any]]: ...
    async def get_document(self, project_id: str, selector: dict[str, str | None]) -> list[dict[str, Any]]: ...
    async def delete_project(self, project_id: str) -> dict[str, Any]: ...
    async def shutdown(self) -> None: ...


@dataclass(frozen=True)
class ProjectNamespace:
    project_id: str
    safe_project_id: str
    working_dir: Path
    chunks_file: Path
    manifest_file: Path


def create_lightrag_engine(settings: LightRagSettings) -> LightRagEngine:
    if settings.backend == "core":
        return CoreLightRagEngine(settings)
    return ContractLightRagEngine(settings)


def normalize_ingest_mode(mode: str) -> str:
    normalized = (mode or "").strip().lower()
    if normalized in {"full", "changed", "document"}:
        return normalized
    return "changed"


def tuning_diagnostics(settings: LightRagSettings) -> dict[str, int]:
    return {
        "max_async": settings.max_async,
        "max_parallel_insert": settings.max_parallel_insert,
        "top_k": settings.top_k,
        "chunk_top_k": settings.chunk_top_k,
        "max_total_tokens": settings.max_total_tokens,
    }


def full_reindex_removed_current_records(documents: list[dict[str, Any]], active_paths: set[str]) -> list[dict[str, Any]]:
    return [record for record in documents if record.get("status") == "current" and record.get("source_path") not in active_paths]


def current_records_for_path(manifest: dict[str, Any], source_path: str) -> list[dict[str, Any]]:
    return [
        record
        for record in manifest.get("documents", [])
        if record.get("source_path") == source_path and record.get("status") == "current"
    ]


def optional_document_chunk_fields(document: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in ("chunk_kind", "chunk_index", "chunk_total", "line_start", "line_end", "chunk_id", "content_hash"):
        if key in document and document[key] is not None:
            out[key] = document[key]
    return out


def expand_spec_neighbor_chunks(matches: list[dict[str, Any]], current: list[dict[str, Any]], radius: int = 1) -> list[dict[str, Any]]:
    if not matches or radius < 1:
        return matches
    by_path: dict[str, list[dict[str, Any]]] = {}
    for record in current:
        by_path.setdefault(str(record["source_path"]), []).append(record)
    for plist in by_path.values():
        plist.sort(key=lambda r: (r.get("chunk_index") if r.get("chunk_index") is not None else 0, r.get("line_start") or 0, str(r.get("chunk_id", ""))))
    seen: dict[str, dict[str, Any]] = {}
    for m in matches:
        seen[str(m.get("chunk_id", ""))] = m
        path = str(m["source_path"])
        plist = by_path.get(path, [])
        idx = next((i for i, r in enumerate(plist) if r.get("chunk_id") == m.get("chunk_id")), -1)
        if idx < 0:
            continue
        for d in range(-radius, radius + 1):
            j = idx + d
            if 0 <= j < len(plist):
                r = plist[j]
                seen[str(r.get("chunk_id", ""))] = r
    return sorted(seen.values(), key=lambda c: (c.get("source_path", ""), c.get("chunk_index") or 0, c.get("line_start") or 0, str(c.get("chunk_id", ""))))


def spec_context_sort_key(chunk: dict[str, Any]) -> tuple[str, int, int, str]:
    return (
        str(chunk.get("source_path", "")),
        int(chunk.get("chunk_index") or 0),
        int(chunk.get("line_start") or 0),
        str(chunk.get("chunk_id", "")),
    )


def document_index_response(chunks: list[dict[str, Any]], filters: dict[str, Any]) -> dict[str, Any]:
    status = str(filters.get("status") or "current")
    chunk_kind = filters.get("chunk_kind")
    order_by = str(filters.get("order_by") or "updated_at")
    order = str(filters.get("order") or "desc")
    limit = clamp_document_limit(filters.get("limit"))
    offset = clamp_document_offset(filters.get("offset"))

    rows = list(chunks)
    if status != "all":
        rows = [chunk for chunk in rows if chunk.get("status") == status]
    if chunk_kind:
        rows = [chunk for chunk in rows if chunk.get("chunk_kind") == chunk_kind]
    rows.sort(key=lambda chunk: document_index_sort_key(chunk, order_by), reverse=order == "desc")
    total = len(rows)
    return {"chunks": rows[offset:offset + limit], "total": total, "limit": limit, "offset": offset}


def document_index_sort_key(chunk: dict[str, Any], order_by: str) -> tuple[Any, str, int, str]:
    value: Any
    if order_by == "chunk_index":
        value = int(chunk.get("chunk_index") or 0)
    else:
        value = str(chunk.get(order_by) or "")
    return (value, str(chunk.get("source_path", "")), int(chunk.get("chunk_index") or 0), str(chunk.get("chunk_id", "")))


def clamp_document_limit(raw: Any) -> int:
    try:
        parsed = int(raw if raw is not None else 50)
    except (TypeError, ValueError):
        return 50
    return min(500, max(1, parsed))


def clamp_document_offset(raw: Any) -> int:
    try:
        parsed = int(raw if raw is not None else 0)
    except (TypeError, ValueError):
        return 0
    return max(0, parsed)


def mark_manifest_record_stale_by_doc_id(manifest: dict[str, Any], doc_id: str, now: str, reason: str) -> None:
    for record in manifest.get("documents", []):
        if record.get("doc_id") == doc_id and record.get("status") == "current":
            record["status"] = "stale"
            record["stale_reason"] = reason
            record["updated_at"] = now
            break


def safe_warning_snip(exc: BaseException, limit: int = 200) -> str:
    return str(exc).replace("\n", " ")[:limit]


def storage_health_report(settings: LightRagSettings, project_id: str | None = None, deep: bool = False) -> dict[str, Any]:
    data_dir = settings.data_dir
    disk = storage_disk_report(data_dir)
    if not data_dir.exists() or not data_dir.is_dir():
        return {
            "status": "degraded",
            "data_dir": str(data_dir),
            "deep": deep,
            "json_validated": False,
            "disk": disk,
            "project_count": 0,
            "projects": {},
            "warnings": ["LightRAG data directory is missing or is not a directory."],
        }

    project_dirs = storage_project_dirs(data_dir, project_id)
    projects: dict[str, Any] = {}
    corrupt_count = 0
    warning_count = 0
    checked_files = 0
    for pid, path in project_dirs.items():
        detail = storage_project_health(pid, path, deep)
        projects[pid] = detail
        corrupt_count += len(detail["corrupt_files"])
        warning_count += len(detail["warnings"])
        checked_files += int(detail["checked_files"])

    status = "corrupt" if corrupt_count else "degraded" if warning_count else "ok" if deep else "unchecked"
    return {
        "status": status,
        "data_dir": str(data_dir),
        "deep": deep,
        "json_validated": deep,
        "disk": disk,
        "project_count": len(projects),
        "checked_files": checked_files,
        "corrupt_file_count": corrupt_count,
        "projects": projects,
        "warnings": [] if projects else ["No LightRAG project storage directories found."],
    }


def storage_disk_report(data_dir: Path) -> dict[str, Any]:
    target = data_dir if data_dir.exists() else data_dir.parent
    try:
        usage = shutil.disk_usage(target)
    except Exception as exc:
        return {"status": "unknown", "error": safe_warning_snip(exc)}
    return {
        "status": "ok",
        "total_bytes": usage.total,
        "used_bytes": usage.used,
        "free_bytes": usage.free,
    }


def storage_project_dirs(data_dir: Path, project_id: str | None) -> dict[str, Path]:
    projects_root = data_dir / "projects"
    if project_id:
        safe = safe_project_id(project_id)
        core_path = projects_root / safe
        if core_path.exists() or projects_root.exists():
            return {project_id: core_path}
        return {project_id: data_dir}
    if projects_root.exists() and projects_root.is_dir():
        return {path.name: path for path in sorted(projects_root.iterdir()) if path.is_dir()}
    return {"contract": data_dir}


def storage_project_health(project_id: str, project_dir: Path, deep: bool) -> dict[str, Any]:
    warnings: list[str] = []
    corrupt_files: list[dict[str, Any]] = []
    files: list[dict[str, Any]] = []
    if not project_dir.exists() or not project_dir.is_dir():
        warnings.append("Project storage directory is missing.")
        return {
            "status": "degraded",
            "project_id": project_id,
            "path": str(project_dir),
            "deep": deep,
            "json_validated": deep,
            "checked_files": 0,
            "json_file_count": 0,
            "total_bytes": 0,
            "files": files,
            "corrupt_files": corrupt_files,
            "warnings": warnings,
        }

    json_paths = sorted(path for path in project_dir.glob("*.json") if path.is_file())
    checked_files = 0
    total_bytes = 0
    for path in json_paths:
        stat = path.stat()
        total_bytes += stat.st_size
        item: dict[str, Any] = {
            "path": str(path),
            "name": path.name,
            "size_bytes": stat.st_size,
            "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        }
        if deep:
            checked_files += 1
            try:
                with path.open("r", encoding="utf-8") as handle:
                    json.load(handle)
                item["json_valid"] = True
            except json.JSONDecodeError as exc:
                item["json_valid"] = False
                item["error"] = str(exc)
                item["line"] = exc.lineno
                item["column"] = exc.colno
                item["position"] = exc.pos
                corrupt_files.append(item)
            except Exception as exc:
                item["json_valid"] = False
                item["error"] = safe_warning_snip(exc)
                corrupt_files.append(item)
        files.append(item)

    status = "corrupt" if corrupt_files else "ok" if deep else "unchecked"
    return {
        "status": status,
        "project_id": project_id,
        "path": str(project_dir),
        "deep": deep,
        "json_validated": deep,
        "checked_files": checked_files,
        "json_file_count": len(json_paths),
        "total_bytes": total_bytes,
        "files": files,
        "corrupt_files": corrupt_files,
        "warnings": warnings,
    }


class ContractLightRagEngine:
    def __init__(self, settings: LightRagSettings):
        self.settings = settings
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)

    async def health(self, project_id: str | None = None, deep: bool = False) -> dict[str, Any]:
        storage_health = storage_health_report(self.settings, project_id, deep)
        return {
            "status": "ok",
            "engine": "lightrag",
            "contract": "pcp-v1",
            "backend": "contract",
            "query_mode": self.settings.query_mode,
            "llm_model": self.settings.llm_model,
            "embedding_model": self.settings.embedding_model,
            "embedding_dim": self.settings.embedding_dim,
            "tuning": tuning_diagnostics(self.settings),
            "llm_configured": bool(self.settings.openai_api_key) if self.settings.llm_provider in {"openai", "openai-compatible"} else True,
            "embedding_configured": bool(self.settings.embedding_model and self.settings.embedding_dim > 0),
            "storage_ready": self.settings.data_dir.exists() and self.settings.data_dir.is_dir(),
            "storage_health": storage_health,
            "graph_ready": None,
            "migration_available": self._migration_available(),
            "core_implemented": False,
            "missing_configuration": [],
        }

    async def storage_health(self, project_id: str | None = None, deep: bool = True) -> dict[str, Any]:
        return storage_health_report(self.settings, project_id, deep)

    async def ingest(self, project_id: str, paths: list[str], mode: str, documents: list[dict[str, Any]]) -> dict[str, Any]:
        chunks = self._load_chunks(project_id)
        if normalize_ingest_mode(mode) == "full":
            active_paths = set(paths)
            chunks = [chunk for chunk in chunks if chunk["source_path"] in active_paths]
        now = iso_now()
        documents_by_path: dict[str, list[dict[str, Any]]] = {}
        for document in documents:
            p = str(document.get("path", ""))
            documents_by_path.setdefault(p, []).append(document)
        inserted = 0
        for source_path in paths:
            docs = documents_by_path.get(source_path, [])
            chunks = [chunk for chunk in chunks if chunk["source_path"] != source_path]
            if not docs:
                chunks.append({
                    "project_id": project_id,
                    "chunk_id": str(uuid.uuid4()),
                    "source_path": source_path,
                    "heading": None,
                    "stable_ids": [],
                    "content": f"Indexed by LightRAG sidecar contract: {source_path}",
                    "document_type": document_type(source_path),
                    "domain": "lightrag",
                    "status": "current",
                    "stale_reason": None,
                    "created_at": now,
                    "updated_at": now,
                })
                inserted += 1
                continue
            for document in docs:
                content = str(document.get("content", ""))
                chunk_id = str(document.get("chunk_id") or uuid.uuid4())
                chunk = {
                    "project_id": project_id,
                    "chunk_id": chunk_id,
                    "source_path": source_path,
                    "heading": document.get("heading"),
                    "stable_ids": list(document.get("stable_ids", [])),
                    "content": content or f"Indexed by LightRAG sidecar contract: {source_path}",
                    "document_type": document_type(source_path),
                    "domain": "lightrag",
                    "status": "current",
                    "stale_reason": None,
                    "created_at": now,
                    "updated_at": now,
                }
                extra = optional_document_chunk_fields(document)
                for key, val in extra.items():
                    if key == "chunk_id":
                        continue
                    chunk[key] = val
                chunks.append(chunk)
                inserted += 1
        self._save_chunks(project_id, chunks)
        return {"indexed": inserted, "warnings": []}

    async def search(self, project_id: str, query: str, filters: dict[str, Any]) -> dict[str, Any]:
        terms = terms_for(query)
        chunks = self._load_chunks(project_id)
        chunks = [chunk for chunk in chunks if chunk.get("status") == "current"]
        document_types = filters.get("document_types")
        if isinstance(document_types, list):
            allowed_types = set(str(item) for item in document_types)
            chunks = [chunk for chunk in chunks if chunk["document_type"] in allowed_types]
        chunk_kinds = filters.get("chunk_kinds")
        if isinstance(chunk_kinds, list) and chunk_kinds:
            allowed_kinds = set(str(item) for item in chunk_kinds)
            chunks = [chunk for chunk in chunks if str(chunk.get("chunk_kind") or "file") in allowed_kinds]
        prefixes = filters.get("source_path_prefixes")
        if isinstance(prefixes, list) and prefixes:
            pset = [str(p) for p in prefixes]
            chunks = [chunk for chunk in chunks if any(str(chunk.get("source_path", "")).startswith(p) for p in pset)]
        ranked = sorted(chunks, key=lambda chunk: score(chunk, terms), reverse=True)
        limit = int(filters.get("limit", 10))
        rows = [chunk for chunk in ranked if score(chunk, terms) > 0 or not terms]
        rows = apply_source_diversity_cap(rows, limit)
        return {"chunks": rows, "warnings": []}

    async def get_spec_context(self, project_id: str, spec_id: str, include_neighbors: bool) -> list[dict[str, Any]]:
        chunks = self._load_chunks(project_id)
        current = [chunk for chunk in chunks if chunk.get("status") == "current"]
        matches = [chunk for chunk in current if spec_id in chunk.get("stable_ids", [])]
        if not matches:
            matches = [chunk for chunk in current if spec_id in chunk.get("source_path", "")]
        matches = sorted(matches, key=spec_context_sort_key)
        if include_neighbors:
            matches = expand_spec_neighbor_chunks(matches, current, radius=1)
        return matches

    async def get_related_code(self, project_id: str, query: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
        merged = dict(filters)
        if not merged.get("document_types"):
            merged["document_types"] = ["code", "test"]
        if merged.get("query_mode") is None:
            merged["query_mode"] = "naive"
        packed = await self.search(project_id, query, merged)
        return packed["chunks"]

    async def get_requirement_sources(self, project_id: str, requirement_id: str) -> list[dict[str, Any]]:
        return [chunk for chunk in self._load_chunks(project_id) if requirement_id in chunk.get("stable_ids", [])]

    async def get_document(self, project_id: str, selector: dict[str, str | None]) -> list[dict[str, Any]]:
        chunk_id = selector.get("chunk_id")
        source_path = selector.get("source_path")
        if not chunk_id and not source_path:
            return []
        chunks = self._load_chunks(project_id)
        if chunk_id:
            matches = [chunk for chunk in chunks if chunk["chunk_id"] == chunk_id]
        else:
            matches = [chunk for chunk in chunks if chunk["source_path"] == source_path]
        return sorted(matches, key=lambda item: item["source_path"])

    async def delete_project(self, project_id: str) -> dict[str, Any]:
        path = self._project_file(project_id)
        had_file = path.exists()
        if had_file:
            path.unlink()
        return {"ok": True, "project_id": project_id, "deleted": had_file}

    async def shutdown(self) -> None:
        return

    def _migration_available(self) -> bool:
        return any(self.settings.data_dir.glob("*-chunks.json")) and not (self.settings.data_dir / "projects").exists()

    def _project_file(self, project_id: str) -> Path:
        return self.settings.data_dir / f"{safe_project_id(project_id)}-chunks.json"

    def _load_chunks(self, project_id: str) -> list[dict[str, Any]]:
        path = self._project_file(project_id)
        if not path.exists():
            return []
        return json.loads(path.read_text())

    def _save_chunks(self, project_id: str, chunks: list[dict[str, Any]]) -> None:
        self._project_file(project_id).write_text(json.dumps(chunks, indent=2))

    async def list_documents(self, project_id: str, filters: dict[str, Any]) -> dict[str, Any]:
        return document_index_response(self._load_chunks(project_id), filters)


class CoreLightRagEngine:
    def __init__(self, settings: LightRagSettings):
        self.settings = settings
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        self._engines: dict[str, Any] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def health(self, project_id: str | None = None, deep: bool = False) -> dict[str, Any]:
        missing = validate_core_ready(self.settings)
        storage_ready = self.settings.data_dir.exists() and self.settings.data_dir.is_dir()
        storage_health = storage_health_report(self.settings, project_id, deep)
        dependency_ready = self._dependencies_ready()
        ready = not missing and storage_ready and dependency_ready
        storage_status = str(storage_health.get("status"))
        base: dict[str, Any] = {
            "status": "ok" if ready and storage_status in {"ok", "unchecked"} else "degraded",
            "engine": "lightrag",
            "contract": "pcp-v1",
            "backend": "core",
            "query_mode": self.settings.query_mode,
            "llm_model": self.settings.llm_model,
            "embedding_model": self.settings.embedding_model,
            "embedding_dim": self.settings.embedding_dim,
            "tuning": tuning_diagnostics(self.settings),
            "llm_configured": bool(self.settings.openai_api_key) if self.settings.llm_provider in {"openai", "openai-compatible"} else True,
            "embedding_configured": bool(self.settings.embedding_model and self.settings.embedding_dim > 0),
            "storage_ready": storage_ready,
            "storage_health": storage_health,
            "graph_ready": None,
            "migration_available": self._migration_available(),
            "core_implemented": True,
            "dependency_ready": dependency_ready,
            "missing_configuration": missing,
        }
        if project_id:
            namespace = self._namespace(project_id)
            manifest = self._load_manifest(namespace)
            current = current_records(manifest)
            manifest_exists = namespace.manifest_file.exists()
            base["lightrag_manifest_ready"] = manifest_exists and bool(manifest.get("documents"))
            base["lightrag_query_ready"] = bool(dependency_ready and not missing)
            busy = False
            for lock in self._locks.values():
                locked_fn = getattr(lock, "locked", None)
                if callable(locked_fn) and locked_fn():
                    busy = True
                    break
            base["lightrag_pipeline_busy"] = busy
            extra_warnings: list[str] = []
            if base["lightrag_manifest_ready"] and not current:
                extra_warnings.append("lightrag_manifest_empty_current")
            if extra_warnings:
                base["warnings"] = extra_warnings
        return base

    async def storage_health(self, project_id: str | None = None, deep: bool = True) -> dict[str, Any]:
        return storage_health_report(self.settings, project_id, deep)

    async def ingest(self, project_id: str, paths: list[str], mode: str, documents: list[dict[str, Any]]) -> dict[str, Any]:
        self._assert_ready(project_id)
        namespace = self._namespace(project_id)
        manifest = self._load_manifest(namespace)
        now = iso_now()
        documents_by_path: dict[str, list[dict[str, Any]]] = {}
        for document in documents:
            p = str(document.get("path", ""))
            documents_by_path.setdefault(p, []).append(document)
        warnings: list[str] = []
        rag = await self._get_engine(project_id)
        mode_norm = normalize_ingest_mode(mode)

        if mode_norm == "full":
            active_paths = set(paths)
            for record in list(current_records(manifest)):
                if record["source_path"] not in active_paths:
                    await self._delete_document_by_id(rag, str(record["doc_id"]), warnings)
                    mark_manifest_record_stale_by_doc_id(manifest, str(record["doc_id"]), now, "removed_from_full_reindex")

        records_to_insert: list[dict[str, Any]] = []
        generation_base = next_generation(manifest)
        generation_slot = 0

        for source_path in paths:
            docs = documents_by_path.get(source_path)
            if not docs:
                warnings.append(f"Skipped missing document payload: {source_path}")
                continue
            desired: list[dict[str, Any]] = []
            for document in docs:
                content = str(document.get("content", ""))
                if not content:
                    continue
                content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
                chunk_id = str(
                    document.get("chunk_id")
                    or hashlib.sha256(f"{project_id}:{source_path}:{content_hash}".encode("utf-8")).hexdigest()
                )
                doc_id = hashlib.sha256(f"{project_id}:{chunk_id}:{content_hash}".encode("utf-8")).hexdigest()
                row: dict[str, Any] = {
                    "project_id": project_id,
                    "doc_id": doc_id,
                    "chunk_id": chunk_id,
                    "source_path": source_path,
                    "heading": document.get("heading"),
                    "stable_ids": list(document.get("stable_ids", [])),
                    "content": content,
                    "document_type": document_type(source_path),
                    "domain": "lightrag-core",
                    "status": "current",
                    "stale_reason": None,
                    "generation": generation_base + generation_slot,
                    "content_hash": content_hash,
                    "created_at": now,
                    "updated_at": now,
                }
                extra = optional_document_chunk_fields(document)
                for key, val in extra.items():
                    if key == "chunk_id":
                        continue
                    row[key] = val
                desired.append(row)
                generation_slot += 1
            if not desired:
                warnings.append(f"Skipped empty document set: {source_path}")
                continue
            previous_records = current_records_for_path(manifest, source_path)
            prev_key = {(str(r.get("chunk_id")), str(r.get("content_hash"))) for r in previous_records}
            new_key = {(str(r.get("chunk_id")), str(r.get("content_hash"))) for r in desired}
            if prev_key == new_key:
                continue
            for rec in previous_records:
                await self._delete_document_by_id(rag, str(rec["doc_id"]), warnings)
                mark_manifest_record_stale_by_doc_id(manifest, str(rec["doc_id"]), now, "replaced")
            records_to_insert.extend(desired)

        inserted_records = await self._insert_batch(rag, records_to_insert, warnings)
        for record in inserted_records:
            manifest["documents"].append(record)

        self._save_manifest(namespace, manifest)
        return {"indexed": len(inserted_records), "warnings": warnings}

    async def search(self, project_id: str, query: str, filters: dict[str, Any]) -> dict[str, Any]:
        self._assert_ready(project_id)
        namespace = self._namespace(project_id)
        manifest = self._load_manifest(namespace)
        candidates = current_records(manifest)
        mode = str(filters.get("query_mode") or self.settings.query_mode)
        limit = int(filters.get("limit", 10))
        warnings: list[str] = []

        if mode == "naive":
            matches = self._manifest_naive_rank(candidates, query, filters)
            return {"chunks": apply_source_diversity_cap(matches, limit), "warnings": warnings}

        rag = await self._get_engine(project_id)
        timeout_ms = int(filters["timeout_ms"]) if filters.get("timeout_ms") is not None else self.settings.search_timeout_ms
        timeout_s = max(timeout_ms, 100) / 1000.0
        response = ""
        try:
            response = await asyncio.wait_for(asyncio.to_thread(self._query, rag, query, filters), timeout=timeout_s)
        except asyncio.TimeoutError:
            warnings.append("lightrag_semantic_timeout")
        except Exception:
            warnings.append("lightrag_semantic_error")

        if warnings:
            matches = self._manifest_naive_rank(candidates, query, filters)
            return {"chunks": apply_source_diversity_cap(matches, limit), "warnings": warnings}

        matches = self._records_from_response(candidates, response, query)
        matches = self._apply_filters(matches, filters)
        return {"chunks": apply_source_diversity_cap(matches, limit), "warnings": warnings}

    def _manifest_naive_rank(self, candidates: list[dict[str, Any]], query: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
        terms = terms_for(query)
        ranked = sorted(candidates, key=lambda record: score(record, terms), reverse=True)
        chunks = [to_chunk(record) for record in ranked if score(record, terms) > 0 or not terms]
        return self._apply_filters(chunks, filters)

    async def list_documents(self, project_id: str, filters: dict[str, Any]) -> dict[str, Any]:
        self._assert_ready(project_id)
        namespace = self._namespace(project_id)
        manifest = self._load_manifest(namespace)
        return document_index_response([to_chunk(record) for record in manifest.get("documents", [])], filters)

    async def get_spec_context(self, project_id: str, spec_id: str, include_neighbors: bool) -> list[dict[str, Any]]:
        namespace = self._namespace(project_id)
        manifest = self._load_manifest(namespace)
        current = current_records(manifest)
        matches = [record for record in current if spec_id in record.get("stable_ids", [])]
        if not matches:
            matches = [record for record in current if spec_id in record["source_path"]]
        matches = sorted(matches, key=spec_context_sort_key)
        if include_neighbors:
            matches = expand_spec_neighbor_chunks(matches, current, radius=1)
        return [to_chunk(record) for record in matches]

    async def get_related_code(self, project_id: str, query: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
        merged = dict(filters)
        if not merged.get("document_types"):
            merged["document_types"] = ["code", "test"]
        if merged.get("query_mode") is None:
            merged["query_mode"] = "naive"
        packed = await self.search(project_id, query, merged)
        return packed["chunks"]

    async def get_requirement_sources(self, project_id: str, requirement_id: str) -> list[dict[str, Any]]:
        namespace = self._namespace(project_id)
        manifest = self._load_manifest(namespace)
        return [to_chunk(record) for record in current_records(manifest) if requirement_id in record.get("stable_ids", [])]

    async def get_document(self, project_id: str, selector: dict[str, str | None]) -> list[dict[str, Any]]:
        namespace = self._namespace(project_id)
        manifest = self._load_manifest(namespace)
        chunk_id = selector.get("chunk_id")
        source_path = selector.get("source_path")
        if not chunk_id and not source_path:
            return []
        records = current_records(manifest)
        if chunk_id:
            matches = [record for record in records if record["chunk_id"] == chunk_id or record["doc_id"] == chunk_id]
        else:
            matches = [record for record in records if record["source_path"] == source_path]
        return [to_chunk(record) for record in sorted(matches, key=spec_context_sort_key)]

    async def delete_project(self, project_id: str) -> dict[str, Any]:
        namespace = self._namespace(project_id)
        await self._finalize_and_evict(project_id)
        deleted = False
        if namespace.working_dir.exists():
            shutil.rmtree(namespace.working_dir)
            deleted = True
        if namespace.chunks_file.exists():
            namespace.chunks_file.unlink()
        return {"ok": True, "project_id": project_id, "deleted": deleted}

    async def shutdown(self) -> None:
        for pid in list(self._engines.keys()):
            await self._finalize_and_evict(pid)

    async def _finalize_and_evict(self, project_id: str) -> None:
        rag = self._engines.pop(project_id, None)
        if rag is None:
            return
        try:
            await self._finalize_rag_storage(rag)
        except Exception:
            return

    async def _finalize_rag_storage(self, rag: Any) -> None:
        finalize = getattr(rag, "finalize_storages", None)
        if not callable(finalize):
            return
        try:
            if inspect.iscoroutinefunction(finalize):
                await finalize()
                return
            result = finalize()
            if inspect.isawaitable(result):
                await result
        except Exception:
            return

    async def _delete_document_by_id(self, rag: Any, doc_id: str, warnings: list[str]) -> None:
        if not doc_id:
            return
        try:
            adelete = getattr(rag, "adelete_by_doc_id", None)
            if callable(adelete):
                outcome = adelete(doc_id)
                if inspect.isawaitable(outcome):
                    await outcome
                return
            sync_delete = getattr(rag, "delete_by_doc_id", None)
            if callable(sync_delete):
                await asyncio.to_thread(sync_delete, doc_id)
                return
            warnings.append("LightRAG document deletion API not available; vendor index may retain stale documents until rebuild.")
        except Exception as exc:
            lowered = str(exc).lower()
            if any(token in lowered for token in ("not found", "does not exist", "missing", "unknown")):
                return
            warnings.append(f"LightRAG delete failed for doc_id prefix {doc_id[:12]}: {safe_warning_snip(exc)}")

    async def _insert_batch(self, rag: Any, records: list[dict[str, Any]], warnings: list[str]) -> list[dict[str, Any]]:
        if not records:
            return []
        try:
            await asyncio.to_thread(self._insert_documents_batch_sync, rag, records)
            return records
        except Exception as exc:
            warnings.append(f"Batch insert failed ({safe_warning_snip(exc)}); retrying per document.")
            inserted: list[dict[str, Any]] = []
            for record in records:
                try:
                    await asyncio.to_thread(self._insert_document_single_sync, rag, record)
                    inserted.append(record)
                except Exception as exc2:
                    warnings.append(f"Insert failed for {record['source_path']}: {safe_warning_snip(exc2)}")
            return inserted

    def _insert_documents_batch_sync(self, rag: Any, records: list[dict[str, Any]]) -> None:
        contents = [document_with_metadata(record) for record in records]
        ids = [record["doc_id"] for record in records]
        paths = [record["source_path"] for record in records]
        try:
            rag.insert(contents, ids=ids, file_paths=paths)
        except TypeError:
            try:
                rag.insert(contents, ids=ids)
            except TypeError:
                for record in records:
                    self._insert_document_single_sync(rag, record)

    def _insert_document_single_sync(self, rag: Any, record: dict[str, Any]) -> None:
        content = document_with_metadata(record)
        try:
            rag.insert([content], ids=[record["doc_id"]], file_paths=[record["source_path"]])
        except TypeError:
            try:
                rag.insert([content], ids=[record["doc_id"]])
            except TypeError:
                rag.insert(content)

    async def _get_engine(self, project_id: str) -> Any:
        if project_id in self._engines:
            return self._engines[project_id]
        lock = self._locks.setdefault(project_id, asyncio.Lock())
        async with lock:
            if project_id in self._engines:
                return self._engines[project_id]
            namespace = self._namespace(project_id)
            namespace.working_dir.mkdir(parents=True, exist_ok=True)
            rag = self._build_engine(namespace)
            await rag.initialize_storages()
            await self._initialize_pipeline_status()
            self._engines[project_id] = rag
            return rag

    def _build_engine(self, namespace: ProjectNamespace) -> Any:
        from lightrag import LightRAG
        from lightrag.llm.openai import openai_complete_if_cache, openai_embed
        from lightrag.utils import EmbeddingFunc

        async def llm_model_func(prompt: str, system_prompt: str | None = None, history_messages: list[dict[str, Any]] | None = None, **kwargs: Any) -> str:
            return await openai_complete_if_cache(
                self.settings.llm_model,
                prompt,
                system_prompt=system_prompt,
                history_messages=history_messages or [],
                base_url=self.settings.openai_base_url,
                api_key=self.settings.openai_api_key,
                **kwargs,
            )

        async def embedding_func(texts: list[str]) -> Any:
            return await openai_embed.func(
                texts,
                model=self.settings.embedding_model,
                base_url=self.settings.openai_base_url,
                api_key=self.settings.openai_api_key,
            )

        core_kwargs: dict[str, Any] = {
            "working_dir": str(namespace.working_dir),
            "llm_model_func": llm_model_func,
            "llm_model_name": self.settings.llm_model,
            "embedding_func": EmbeddingFunc(
                embedding_dim=self.settings.embedding_dim,
                max_token_size=self.settings.embedding_max_token_size,
                model_name=self.settings.embedding_model,
                func=embedding_func,
            ),
        }
        tuned_kwargs = {
            "llm_model_max_async": self.settings.max_async,
            "max_parallel_insert": self.settings.max_parallel_insert,
        }
        try:
            return LightRAG(**core_kwargs, **tuned_kwargs)
        except TypeError:
            return LightRAG(**core_kwargs)

    async def _initialize_pipeline_status(self) -> None:
        try:
            from lightrag.kg.shared_storage import initialize_pipeline_status
        except ImportError:
            return
        await initialize_pipeline_status()

    def _query(self, rag: Any, query: str, filters: dict[str, Any] | None = None) -> str:
        from lightrag import QueryParam

        filters = filters or {}
        mode = str(filters.get("query_mode") or self.settings.query_mode)
        top_k = int(filters["top_k"]) if filters.get("top_k") is not None else self.settings.top_k
        chunk_top_k = int(filters["chunk_top_k"]) if filters.get("chunk_top_k") is not None else self.settings.chunk_top_k
        max_total_tokens = (
            int(filters["max_total_tokens"]) if filters.get("max_total_tokens") is not None else self.settings.max_total_tokens
        )
        kw_sets = (
            dict(mode=mode, only_need_context=True, top_k=top_k, chunk_top_k=chunk_top_k, max_total_tokens=max_total_tokens),
            dict(mode=mode, only_need_context=True, top_k=top_k, chunk_top_k=chunk_top_k),
            dict(mode=mode, only_need_context=True),
            dict(mode=mode),
        )
        param: Any = None
        for kw in kw_sets:
            try:
                param = QueryParam(**kw)
                break
            except TypeError:
                continue
        if param is None:
            param = QueryParam(mode=mode)
        return str(rag.query(query, param=param))

    def _records_from_response(self, records: list[dict[str, Any]], response: str, query: str) -> list[dict[str, Any]]:
        response_lower = response.lower()
        referenced = [
            record for record in records
            if record["source_path"].lower() in response_lower
            or any(stable_id.lower() in response_lower for stable_id in record.get("stable_ids", []))
        ]
        if referenced:
            return [to_chunk(record, response if len(referenced) == 1 else None) for record in referenced]
        terms = terms_for(query)
        ranked = sorted(records, key=lambda record: score(record, terms), reverse=True)
        return [to_chunk(record) for record in ranked if score(record, terms) > 0 or not terms]

    def _apply_filters(self, chunks: list[dict[str, Any]], filters: dict[str, Any]) -> list[dict[str, Any]]:
        document_types = filters.get("document_types")
        if isinstance(document_types, list):
            allowed = set(str(item) for item in document_types)
            chunks = [chunk for chunk in chunks if chunk["document_type"] in allowed]
        chunk_kinds = filters.get("chunk_kinds")
        if isinstance(chunk_kinds, list) and chunk_kinds:
            allowed_kinds = set(str(item) for item in chunk_kinds)
            chunks = [chunk for chunk in chunks if str(chunk.get("chunk_kind") or "file") in allowed_kinds]
        prefixes = filters.get("source_path_prefixes")
        if isinstance(prefixes, list) and prefixes:
            pset = [str(p) for p in prefixes]
            chunks = [chunk for chunk in chunks if any(str(chunk.get("source_path", "")).startswith(p) for p in pset)]
        stable_id = filters.get("stable_id")
        if isinstance(stable_id, str):
            chunks = [chunk for chunk in chunks if stable_id in chunk.get("stable_ids", [])]
        source_path = filters.get("source_path")
        if isinstance(source_path, str):
            chunks = [chunk for chunk in chunks if chunk["source_path"] == source_path]
        return chunks

    def _dependencies_ready(self) -> bool:
        try:
            import lightrag  # noqa: F401
            from lightrag.llm import openai  # noqa: F401
        except ImportError:
            return False
        return True

    def _assert_ready(self, project_id: str) -> None:
        missing = validate_core_ready(self.settings)
        if missing:
            raise EngineNotReadyError("LightRAG core backend is missing required configuration.", {"missing_configuration": missing})
        if not self._dependencies_ready():
            raise EngineNotReadyError("LightRAG core dependencies are unavailable.", {"project_id": project_id})

    def _migration_available(self) -> bool:
        return any(self.settings.data_dir.glob("*-chunks.json"))

    def _namespace(self, project_id: str) -> ProjectNamespace:
        safe = safe_project_id(project_id)
        working_dir = self.settings.data_dir / "projects" / safe
        return ProjectNamespace(
            project_id=project_id,
            safe_project_id=safe,
            working_dir=working_dir,
            chunks_file=self.settings.data_dir / f"{safe}-chunks.json",
            manifest_file=working_dir / "pcp-manifest.json",
        )

    def _load_manifest(self, namespace: ProjectNamespace) -> dict[str, Any]:
        if not namespace.manifest_file.exists():
            return {"project_id": namespace.project_id, "manifest_version": 1, "documents": []}
        return json.loads(namespace.manifest_file.read_text())

    def _save_manifest(self, namespace: ProjectNamespace, manifest: dict[str, Any]) -> None:
        namespace.working_dir.mkdir(parents=True, exist_ok=True)
        namespace.manifest_file.write_text(json.dumps(manifest, indent=2))


def safe_project_id(project_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "-", project_id)


def current_records(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    return [record for record in manifest.get("documents", []) if record.get("status") == "current"]


def next_generation(manifest: dict[str, Any]) -> int:
    generations = [int(record.get("generation", 0)) for record in manifest.get("documents", [])]
    return max(generations, default=0) + 1


def to_chunk(record: dict[str, Any], content_override: str | None = None) -> dict[str, Any]:
    base: dict[str, Any] = {
        "project_id": record["project_id"],
        "chunk_id": record["chunk_id"],
        "source_path": record["source_path"],
        "heading": record.get("heading"),
        "stable_ids": record.get("stable_ids", []),
        "content": content_override or record.get("content", ""),
        "document_type": record.get("document_type", "doc"),
        "domain": record.get("domain", "lightrag"),
        "status": record.get("status", "current"),
        "stale_reason": record.get("stale_reason"),
        "created_at": record.get("created_at", iso_now()),
        "updated_at": record.get("updated_at", iso_now()),
    }
    for key in ("chunk_kind", "chunk_index", "chunk_total", "line_start", "line_end", "content_hash"):
        if record.get(key) is not None:
            base[key] = record[key]
    return base


def document_with_metadata(record: dict[str, Any]) -> str:
    metadata = [
        f"PCP_SOURCE_PATH: {record['source_path']}",
        f"PCP_HEADING: {record.get('heading') or ''}",
        f"PCP_STABLE_IDS: {', '.join(record.get('stable_ids', []))}",
        f"PCP_DOCUMENT_TYPE: {record.get('document_type', 'doc')}",
    ]
    return "\n".join(metadata) + "\n\n" + record.get("content", "")


def terms_for(query: str) -> list[str]:
    return [term.lower() for term in re.split(r"\W+", query) if term]


def score(chunk: dict[str, Any], terms: list[str]) -> int:
    sid = " ".join(chunk.get("stable_ids") or [])
    haystack = f"{chunk.get('source_path', '')}\n{chunk.get('heading') or ''}\n{sid}\n{chunk.get('content', '')}".lower()
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
