#!/usr/bin/env python3
"""Offline smoke tests for the LightRAG sidecar (no live LLM)."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from config import bounded_int, load_settings  # noqa: E402
from lightrag_engine import (  # noqa: E402
    ContractLightRagEngine,
    CoreLightRagEngine,
    full_reindex_removed_current_records,
    normalize_ingest_mode,
    storage_health_report,
)


def test_bounded_int() -> None:
    assert bounded_int("not-a-number", fallback=4, minimum=1, maximum=32) == 4
    assert bounded_int("500", fallback=4, minimum=1, maximum=32) == 32
    assert bounded_int("0", fallback=4, minimum=1, maximum=32) == 4


def test_manifest_helpers() -> None:
    docs = [
        {"status": "current", "source_path": "a.md"},
        {"status": "current", "source_path": "b.md"},
        {"status": "stale", "source_path": "c.md"},
    ]
    absent = full_reindex_removed_current_records(docs, {"a.md"})
    assert len(absent) == 1
    assert absent[0]["source_path"] == "b.md"


def test_normalize_mode() -> None:
    assert normalize_ingest_mode("FULL") == "full"
    assert normalize_ingest_mode("") == "changed"


def test_storage_health_detects_corrupt_json(tmp_home: str) -> None:
    os.environ["LIGHTRAG_DATA_DIR"] = tmp_home
    os.environ["LIGHTRAG_BACKEND"] = "core"
    os.environ["OPENAI_API_KEY"] = "offline-test-key"
    settings = load_settings()
    project_dir = Path(tmp_home) / "projects" / "pbad"
    project_dir.mkdir(parents=True)
    (project_dir / "pcp-manifest.json").write_text('{"project_id":"pbad"}')
    (project_dir / "vdb_entities.json").write_text('{"broken": true')

    shallow = storage_health_report(settings, "pbad", deep=False)
    assert shallow["status"] == "unchecked"
    assert shallow["json_validated"] is False
    assert shallow["projects"]["pbad"]["status"] == "unchecked"
    assert shallow["projects"]["pbad"]["checked_files"] == 0

    deep = storage_health_report(settings, "pbad", deep=True)
    assert deep["status"] == "corrupt"
    assert deep["json_validated"] is True
    assert deep["corrupt_file_count"] == 1
    corrupt = deep["projects"]["pbad"]["corrupt_files"]
    assert corrupt[0]["name"] == "vdb_entities.json"


async def test_contract_health_shutdown(tmp_home: str) -> None:
    os.environ["LIGHTRAG_DATA_DIR"] = tmp_home
    os.environ["LIGHTRAG_BACKEND"] = "contract"
    os.environ["LIGHTRAG_MAX_ASYNC"] = "9"
    settings = load_settings()
    engine = ContractLightRagEngine(settings)
    health = await engine.health()
    assert health["backend"] == "contract"
    assert health["tuning"]["max_async"] == 9
    assert health["query_mode"]
    await engine.shutdown()


class FakeRAG:
    def __init__(self) -> None:
        self.insert_calls: list[tuple[int, tuple[str, ...], tuple[str, ...]]] = []
        self.deletes: list[str] = []
        self.finalized = False

    async def initialize_storages(self) -> None:
        return

    async def adelete_by_doc_id(self, doc_id: str) -> None:
        self.deletes.append(doc_id)

    def insert(self, contents: list[str], ids: list[str] | None = None, file_paths: list[str] | None = None) -> None:
        ids_t = tuple(ids or ())
        fps_t = tuple(file_paths or ())
        self.insert_calls.append((len(contents), ids_t, fps_t))

    async def finalize_storages(self) -> None:
        self.finalized = True


def _write_manifest(engine: CoreLightRagEngine, project_id: str, documents: list[dict[str, object]]) -> None:
    namespace = engine._namespace(project_id)
    namespace.working_dir.mkdir(parents=True, exist_ok=True)
    payload = {"project_id": project_id, "manifest_version": 1, "documents": documents}
    namespace.manifest_file.write_text(json.dumps(payload, indent=2))


async def test_core_changed_reconcile_and_shutdown(tmp_home: str) -> None:
    os.environ["LIGHTRAG_DATA_DIR"] = tmp_home
    os.environ["LIGHTRAG_BACKEND"] = "core"
    os.environ["OPENAI_API_KEY"] = "offline-test-key"

    settings = load_settings()
    engine = CoreLightRagEngine(settings)
    fake = FakeRAG()

    async def fake_get_engine(_self: CoreLightRagEngine, project_id: str) -> FakeRAG:
        _self._engines[project_id] = fake
        return fake

    engine._get_engine = types.MethodType(fake_get_engine, engine)  # type: ignore[method-assign]
    engine._dependencies_ready = lambda: True  # type: ignore[method-assign, assignment]

    old_id = "old-stable-doc-id"
    _write_manifest(engine, "p1", [
        {
            "project_id": "p1",
            "doc_id": old_id,
            "chunk_id": old_id,
            "source_path": "x.md",
            "heading": None,
            "stable_ids": [],
            "content": "alpha",
            "document_type": "doc",
            "domain": "lightrag-core",
            "status": "current",
            "content_hash": "aaa",
            "generation": 1,
            "created_at": "t",
            "updated_at": "t",
        }
    ])

    await engine.ingest("p1", ["x.md"], "changed", [{"path": "x.md", "content": "beta", "stable_ids": [], "heading": None}])

    assert old_id in fake.deletes
    assert len(fake.insert_calls) == 1
    assert fake.insert_calls[0][0] == 1

    await engine.shutdown()
    assert fake.finalized is True


async def test_core_full_mode_removal(tmp_home: str) -> None:
    os.environ["LIGHTRAG_DATA_DIR"] = tmp_home
    os.environ["LIGHTRAG_BACKEND"] = "core"
    os.environ["OPENAI_API_KEY"] = "offline-test-key"

    kh = hashlib.sha256(b"k").hexdigest()
    gh = hashlib.sha256(b"g").hexdigest()

    settings = load_settings()
    engine = CoreLightRagEngine(settings)
    fake = FakeRAG()

    async def fake_get_engine(_self: CoreLightRagEngine, project_id: str) -> FakeRAG:
        _self._engines[project_id] = fake
        return fake

    engine._get_engine = types.MethodType(fake_get_engine, engine)  # type: ignore[method-assign]
    engine._dependencies_ready = lambda: True  # type: ignore[method-assign, assignment]

    gone_id = "gone-doc"
    _write_manifest(engine, "p2", [
        {
            "project_id": "p2",
            "doc_id": "keep-doc",
            "chunk_id": "keep-doc",
            "source_path": "keep.md",
            "heading": None,
            "stable_ids": [],
            "content": "k",
            "document_type": "doc",
            "domain": "lightrag-core",
            "status": "current",
            "content_hash": kh,
            "generation": 1,
            "created_at": "t",
            "updated_at": "t",
        },
        {
            "project_id": "p2",
            "doc_id": gone_id,
            "chunk_id": gone_id,
            "source_path": "gone.md",
            "heading": None,
            "stable_ids": [],
            "content": "g",
            "document_type": "doc",
            "domain": "lightrag-core",
            "status": "current",
            "content_hash": gh,
            "generation": 2,
            "created_at": "t",
            "updated_at": "t",
        },
    ])

    await engine.ingest("p2", ["keep.md"], "full", [{"path": "keep.md", "content": "k", "stable_ids": [], "heading": None}])

    assert gone_id in fake.deletes
    manifest = json.loads(engine._namespace("p2").manifest_file.read_text())
    stale_paths = {record["source_path"] for record in manifest["documents"] if record.get("status") == "stale"}
    assert "gone.md" in stale_paths

    await engine.shutdown()


async def test_core_batch_insert_single_call(tmp_home: str) -> None:
    os.environ["LIGHTRAG_DATA_DIR"] = tmp_home
    os.environ["LIGHTRAG_BACKEND"] = "core"
    os.environ["OPENAI_API_KEY"] = "offline-test-key"

    settings = load_settings()
    engine = CoreLightRagEngine(settings)
    fake = FakeRAG()

    async def fake_get_engine(_self: CoreLightRagEngine, project_id: str) -> FakeRAG:
        _self._engines[project_id] = fake
        return fake

    engine._get_engine = types.MethodType(fake_get_engine, engine)  # type: ignore[method-assign]
    engine._dependencies_ready = lambda: True  # type: ignore[method-assign, assignment]

    _write_manifest(engine, "p3", [])

    await engine.ingest(
        "p3",
        ["a.md", "b.md"],
        "changed",
        [
            {"path": "a.md", "content": "one", "stable_ids": ["REQ-1"], "heading": "A"},
            {"path": "b.md", "content": "two", "stable_ids": [], "heading": "B"},
        ],
    )

    assert len(fake.insert_calls) == 1
    assert fake.insert_calls[0][0] == 2

    await engine.shutdown()


async def test_core_multi_chunk_single_path_batch(tmp_home: str) -> None:
    os.environ["LIGHTRAG_DATA_DIR"] = tmp_home
    os.environ["LIGHTRAG_BACKEND"] = "core"
    os.environ["OPENAI_API_KEY"] = "offline-test-key"

    settings = load_settings()
    engine = CoreLightRagEngine(settings)
    fake = FakeRAG()

    async def fake_get_engine(_self: CoreLightRagEngine, project_id: str) -> FakeRAG:
        _self._engines[project_id] = fake
        return fake

    engine._get_engine = types.MethodType(fake_get_engine, engine)  # type: ignore[method-assign]
    engine._dependencies_ready = lambda: True  # type: ignore[method-assign, assignment]

    _write_manifest(engine, "p4", [])

    await engine.ingest(
        "p4",
        ["x.md"],
        "changed",
        [
            {"path": "x.md", "content": "one", "stable_ids": [], "heading": "A", "chunk_id": "a1"},
            {"path": "x.md", "content": "two", "stable_ids": ["REQ-Z-1"], "heading": "B", "chunk_id": "a2"},
        ],
    )

    assert len(fake.insert_calls) == 1
    assert fake.insert_calls[0][0] == 2

    manifest = json.loads(engine._namespace("p4").manifest_file.read_text())
    current = [r for r in manifest["documents"] if r.get("status") == "current"]
    assert len(current) == 2

    ctx = await engine.get_spec_context("p4", "REQ-Z-1", False)
    assert len(ctx) == 1
    assert "two" in ctx[0]["content"]

    ctx_nb = await engine.get_spec_context("p4", "REQ-Z-1", True)
    assert len(ctx_nb) == 2

    listed = await engine.list_documents("p4", {"status": "current", "chunk_kind": "markdown_table_row", "limit": 1, "offset": 0})
    assert listed["total"] == 0
    listed_all = await engine.list_documents("p4", {"status": "current", "order_by": "updated_at", "order": "desc"})
    assert listed_all["total"] == 2
    assert len(listed_all["chunks"]) == 2

    await engine.shutdown()


async def test_contract_multi_chunk_same_path(tmp_home: str) -> None:
    os.environ["LIGHTRAG_DATA_DIR"] = tmp_home
    os.environ["LIGHTRAG_BACKEND"] = "contract"
    settings = load_settings()
    engine = ContractLightRagEngine(settings)

    res = await engine.ingest(
        "cproj",
        ["d.md"],
        "changed",
        [
            {"path": "d.md", "content": "alpha", "stable_ids": []},
            {"path": "d.md", "content": "beta REQ-M-1", "stable_ids": ["REQ-M-1"], "chunk_index": 1},
        ],
    )
    assert res["indexed"] == 2
    chunks = engine._load_chunks("cproj")
    paths = [c["source_path"] for c in chunks if c.get("status") == "current"]
    assert paths.count("d.md") == 2

    spec = await engine.get_spec_context("cproj", "REQ-M-1", False)
    assert len(spec) == 1
    spec_nb = await engine.get_spec_context("cproj", "REQ-M-1", True)
    assert len(spec_nb) == 2

    listed = await engine.list_documents("cproj", {"status": "current", "limit": 1, "offset": 1, "order_by": "chunk_index", "order": "asc"})
    assert listed["total"] == 2
    assert listed["limit"] == 1
    assert listed["offset"] == 1
    assert len(listed["chunks"]) == 1
    assert listed["chunks"][0].get("stable_ids") == ["REQ-M-1"]

    await engine.shutdown()


async def test_contract_search_source_diversity(tmp_home: str) -> None:
    os.environ["LIGHTRAG_DATA_DIR"] = tmp_home
    os.environ["LIGHTRAG_BACKEND"] = "contract"
    settings = load_settings()
    engine = ContractLightRagEngine(settings)
    await engine.ingest(
        "div",
        ["AGENTS.md", "packages/core/src/services/ingestion-service.ts", "docs/handover.md"],
        "changed",
        [
            {"path": "AGENTS.md", "content": "ingestion service agent guidance one", "stable_ids": [], "chunk_kind": "markdown_section", "chunk_index": 0},
            {"path": "AGENTS.md", "content": "ingestion service agent guidance two", "stable_ids": [], "chunk_kind": "markdown_section", "chunk_index": 1},
            {"path": "AGENTS.md", "content": "ingestion service agent guidance three", "stable_ids": [], "chunk_kind": "markdown_section", "chunk_index": 2},
            {
                "path": "packages/core/src/services/ingestion-service.ts",
                "content": "path: packages/core/src/services/ingestion-service.ts\ningestion service code summary",
                "stable_ids": [],
                "chunk_kind": "file",
            },
            {"path": "docs/handover.md", "content": "ingestion service handover notes", "stable_ids": [], "chunk_kind": "markdown_section", "chunk_index": 0},
        ],
    )
    packed = await engine.search("div", "ingestion service", {"limit": 5, "query_mode": "naive"})
    chunks = packed["chunks"]
    assert len(chunks) == 5
    paths = {str(c.get("source_path", "")) for c in chunks}
    assert "packages/core/src/services/ingestion-service.ts" in paths
    assert len(paths) >= 2
    assert any(str(c.get("source_path", "")) != "AGENTS.md" for c in chunks)
    filtered = await engine.search(
        "div",
        "ingestion",
        {"limit": 5, "query_mode": "naive", "document_types": ["code"], "source_path_prefixes": ["packages/core/"]},
    )
    assert filtered["chunks"]
    assert all(c["document_type"] == "code" for c in filtered["chunks"])
    assert all(str(c.get("source_path", "")).startswith("packages/core/") for c in filtered["chunks"])
    await engine.shutdown()


async def test_contract_search_budget_filters(tmp_home: str) -> None:
    os.environ["LIGHTRAG_DATA_DIR"] = tmp_home
    os.environ["LIGHTRAG_BACKEND"] = "contract"
    settings = load_settings()
    engine = ContractLightRagEngine(settings)
    await engine.ingest(
        "sf",
        ["pkg/a.ts", "docs/b.md"],
        "changed",
        [
            {"path": "pkg/a.ts", "content": "foo bar feature", "stable_ids": []},
            {"path": "docs/b.md", "content": "foo bar feature doc", "stable_ids": [], "chunk_kind": "markdown_section"},
        ],
    )
    code_only = await engine.search("sf", "feature", {"limit": 10, "document_types": ["code"]})
    assert code_only["chunks"]
    assert all(c["document_type"] == "code" for c in code_only["chunks"])
    prefixed = await engine.search("sf", "feature", {"limit": 10, "source_path_prefixes": ["docs/"]})
    assert all(str(c.get("source_path", "")).startswith("docs/") for c in prefixed["chunks"])
    kind_rows = await engine.search("sf", "feature", {"limit": 10, "chunk_kinds": ["markdown_section"]})
    assert kind_rows["chunks"]
    assert all(str(c.get("chunk_kind") or "file") == "markdown_section" for c in kind_rows["chunks"])
    rel = await engine.get_related_code("sf", "feature", {"limit": 5})
    assert all(c["document_type"] in {"code", "test"} for c in rel)
    rel_types = await engine.get_related_code("sf", "feature", {"limit": 5, "document_types": ["code"]})
    assert all(c["document_type"] == "code" for c in rel_types)
    await engine.shutdown()


def test_validate_budget_limits_smoke(tmp_home: str) -> None:
    os.environ["LIGHTRAG_DATA_DIR"] = tmp_home
    os.environ["LIGHTRAG_BACKEND"] = "contract"
    s = load_settings()
    from search_budget import validate_search_budget_limits  # noqa: E402

    bad_limit = validate_search_budget_limits(s, limit=0, top_k=None, chunk_top_k=None, max_total_tokens=None)
    assert bad_limit is not None
    bad_topk = validate_search_budget_limits(s, limit=10, top_k=s.top_k + 1, chunk_top_k=None, max_total_tokens=None)
    assert bad_topk is not None
    ok = validate_search_budget_limits(s, limit=10, top_k=s.top_k, chunk_top_k=None, max_total_tokens=None)
    assert ok is None
    bad_timeout = validate_search_budget_limits(s, limit=10, top_k=None, chunk_top_k=None, max_total_tokens=None, timeout_ms=50)
    assert bad_timeout is not None


async def main() -> None:
    import tempfile

    test_bounded_int()
    test_manifest_helpers()
    test_normalize_mode()
    with tempfile.TemporaryDirectory() as tmp:
        test_storage_health_detects_corrupt_json(tmp)

    with tempfile.TemporaryDirectory() as tmp:
        await test_contract_health_shutdown(tmp)
    with tempfile.TemporaryDirectory() as tmp:
        await test_core_changed_reconcile_and_shutdown(tmp)
    with tempfile.TemporaryDirectory() as tmp:
        await test_core_full_mode_removal(tmp)
    with tempfile.TemporaryDirectory() as tmp:
        await test_core_batch_insert_single_call(tmp)
    with tempfile.TemporaryDirectory() as tmp:
        await test_core_multi_chunk_single_path_batch(tmp)
    with tempfile.TemporaryDirectory() as tmp:
        await test_contract_multi_chunk_same_path(tmp)

    with tempfile.TemporaryDirectory() as tmp:
        test_validate_budget_limits_smoke(tmp)
    with tempfile.TemporaryDirectory() as tmp:
        await test_contract_search_budget_filters(tmp)
    with tempfile.TemporaryDirectory() as tmp:
        await test_contract_search_source_diversity(tmp)

    print("lightrag_sidecar_smoke_ok")


if __name__ == "__main__":
    asyncio.run(main())
