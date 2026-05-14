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


async def main() -> None:
    import tempfile

    test_bounded_int()
    test_manifest_helpers()
    test_normalize_mode()

    with tempfile.TemporaryDirectory() as tmp:
        await test_contract_health_shutdown(tmp)
    with tempfile.TemporaryDirectory() as tmp:
        await test_core_changed_reconcile_and_shutdown(tmp)
    with tempfile.TemporaryDirectory() as tmp:
        await test_core_full_mode_removal(tmp)
    with tempfile.TemporaryDirectory() as tmp:
        await test_core_batch_insert_single_call(tmp)

    print("lightrag_sidecar_smoke_ok")


if __name__ == "__main__":
    asyncio.run(main())
