# MCP Tool Runtime Improvements

Date: 2026-05-18 (investigation) · Last updated: 2026-05-19

This document started as runtime investigation input for SPDD analysis. Several
recommendations below have since been implemented; see **Implementation status**
first, then the original findings for history and remaining gaps.

Related implementation artifacts:

- `spdd/prompt/GGQPA-XXX-202605191400-[Feat]-search-docs-discovery-ranking.md`
- `packages/core/src/retrieval/manifest-search-ranking.ts`
- `services/lightrag/search_ranking.py`
- `packages/core/src/services/ingestion-chunking/source-file-summary.ts`

Agent-facing usage is summarized in `docs/mcp-tool-usage-guide.md`, `AGENTS.md`,
and `README.md`.

## Implementation status (2026-05-19)

### Search and discovery — implemented

| Area | Status | Notes |
| --- | --- | --- |
| Manifest-backed **`query_mode: "naive"`** in core sidecar | Done | `CoreLightRagEngine.search()` ranks manifest records without `rag.query()` when mode is `naive`. |
| Semantic timeout / error fallback | Done | Timeout or query failure falls back to `_manifest_naive_rank()` with warnings (`lightrag_semantic_timeout`, `lightrag_semantic_error`). |
| **`get_related_code` metadata-first default** | Done | Defaults `document_types: ["code","test"]` and `query_mode: "naive"`. |
| **Source-diversity ranking** | Done | Max **2** chunks per `source_path` after score sort, with backfill — TS (`manifest-search-ranking.ts`, local adapter) and Python (`search_ranking.py`, all `/v1/search` paths). |
| **Shared manifest scorer** | Done | Considers `source_path`, `heading`, stable IDs, and indexed `content`; path/heading term bonuses in TS local adapter. |
| **Enriched code summary cards** | Done | Non-Markdown chunks include `basename`, `path_tokens`, `primary_symbol` (plus symbols, hash). Requires re-ingest to refresh stale summaries. |
| MCP retrieval budget fields | Done | `search_docs` / `get_related_code` expose `document_types`, `source_path_prefixes`, `chunk_kinds`, `query_mode`, token/time budgets in `server.ts`. |
| Agent docs for retrieval workflow | Done | Broad `search_docs` = discovery; implementation lookup = `get_related_code` or scoped search; code `get_document` = summary only. |

**Observed after full re-ingest (2026-05-19):** broad `search_docs("ingestion service")` no longer returns 10× `AGENTS.md`; diversity cap and mixed `source_path` results work. `get_related_code` reliably surfaces ingestion code paths. Naive + `document_types: ["code"]` finds `ingestion-service.ts`; unscoped broad search may still favor architectural Markdown over a specific `.ts` file — expected; use scoped tools for implementation lookup.

### Validation and metadata — partially implemented

| Area | Status | Notes |
| --- | --- | --- |
| Structured **`validate_against_specs`** (REST + MCP) | Done | Evidence pipeline in `spec-validation-pipeline.ts` / composer service. |
| SQLite chunk persistence on ingest | Done | `IngestionService.ingestPaths()` builds metadata chunks and calls `repository.saveChunks()`. |
| **`metadata_lightrag_chunk_divergence`** finding | Done | Emitted when LightRAG resolves paths SQLite does not. |
| **`platform_runtime`** MCP tool | Done | Node/adapter identity without calling LightRAG. |
| Sidecar **`lightrag_query_ready` / `lightrag_pipeline_busy`** | Done | Exposed on deep health in core mode. |
| Eliminate all `path_not_indexed` false positives | Partial | Improved after metadata persistence; edge cases and stale indexes may still warn. |
| MCP connector stale-runtime detection | Partial | `platform_runtime` helps; duplicate/stale MCP processes remain an operator concern. |

### Still open / follow-up

1. **Semantic default search** — When callers omit `query_mode: "naive"`, core mode still enters `rag.query()` and can be slow or unavailable while LightRAG pipeline work continues after ingest completes.
2. **Basename / primary-symbol scorer boost** — Enriched summaries are indexed, but naive ranking does not yet extra-weight `basename` or `primary_symbol` matches; sibling paths under `ingestion-chunking/` can outrank `ingestion-service.ts` on broad queries.
3. **Query readiness UX** — Health fields exist; MCP tools do not yet surface a unified readiness model to agents before expensive semantic calls.
4. **Preview token cost** — Large `stable_ids` arrays in MCP previews (`docs/improvements.md`) remain a separate optimization.

---

## Investigation context (2026-05-18)

The LightRAG sidecar reported healthy storage and dependencies at:

```text
http://127.0.0.1:9621/health?project_id=pcp&deep=true
```

Health output confirmed `backend: "core"`, embeddings/LLM configured, and
`storage_health.status: "ok"`. That did **not** prove `rag.query()` would return
within agent budgets while background extraction/merge work was still running.

At investigation time, `POST /v1/search` with semantic modes could hang until the
client aborted, while `POST /v1/document` returned quickly. **`query_mode: "naive"`
now bypasses `rag.query()` in core mode** (see implementation status above).

---

## Current working baseline

These parts are working after subsequent SPDD work and full re-ingest:

- Full/changed ingestion completes and indexes hundreds of chunks (example: `108`
  files scanned, `543` indexed on 2026-05-19).
- `get_document` resolves LightRAG manifest-backed chunks by path or `chunk_id`.
- **Source-file lightweight indexing** stores compact summaries, not full bodies.
- **Enriched summaries** include `basename`, `path_tokens`, `primary_symbol`.
- Markdown chunking remains granular (`markdown_section`, `markdown_table_row`,
  `stable_id_anchor`).
- Stable IDs on source summary chunks still resolve via `get_spec_context`.
- **`search_docs` / `get_related_code`** with `query_mode: "naive"` use manifest
  ranking; semantic modes use bounded timeout with manifest fallback.
- **Source-diversity cap** prevents one file from monopolizing broad search results.

Evidence examples:

- `get_document` for `packages/core/src/services/ingestion-service.ts` returns a
  summary card with `basename: ingestion-service.ts`, `path_tokens: core,
  ingestion, service`, `primary_symbol: IngestionService`.
- `get_spec_context` for stable IDs returns exact granular Markdown chunks
  (`markdown_table_row` where applicable).
- Broad MCP `search_docs("ingestion service")` returns diverse doc + code paths,
  not a single-file flood.

---

## Tool 1: `search_docs`

### Original observed behavior (2026-05-18)

- MCP returned `BACKEND_UNAVAILABLE` in some runs.
- `POST /v1/search` hung for semantic modes while LightRAG was busy post-ingest.
- Core mode entered `rag.query()` even when `query_mode: "naive"` was requested.

### Current code path

MCP → `RetrievalService.searchDocs()` → HTTP/local LightRAG adapter →
`POST /v1/search` → `CoreLightRagEngine.search()` or `ContractLightRagEngine.search()`.

Ranking helpers:

- TypeScript local/contract path: `packages/core/src/retrieval/manifest-search-ranking.ts`
- Python sidecar: `services/lightrag/search_ranking.py` + engine `score()` / `_manifest_naive_rank()`

### Current behavior

- **`query_mode: "naive"`** — manifest keyword ranking only; no `rag.query()`.
- **Semantic modes** — `asyncio.wait_for` around `_query`; on timeout/error,
  manifest naive fallback + warning.
- **All modes** — `apply_source_diversity_cap()` before returning `{ chunks }`.
- **MCP** — preview clamp (default 5, max 10); optional scope/budget fields.

### Remaining recommendations

1. Consider defaulting MCP `search_docs` to `query_mode: "naive"` unless the caller
   explicitly opts into semantic search (product decision; not implemented).
2. Add basename / `primary_symbol` scoring bonus so exact file-name queries rank
   the owning source file above directory neighbors.
3. Surface sidecar `lightrag_query_ready` in tool warnings when semantic mode is
   requested but pipeline is busy.

---

## Tool 2: `get_related_code`

### Original observed behavior (2026-05-18)

- Inherited hung semantic `search()` path.
- MCP schema under-documented scope/budget fields.

### Current behavior

- Sidecar defaults: `document_types: ["code","test"]`, `query_mode: "naive"`.
- Ranks **source summary cards** (path, tokens, symbols) — not full source bodies.
- Same diversity cap and MCP preview limits as `search_docs`.
- MCP schema documents `document_types`, `source_path_prefixes`, `chunk_kinds`,
  `query_mode`, and token/time budgets.

### Remaining recommendations

1. Keep semantic related-code explicit and budgeted when added as a first-class
   mode (optional escalation only).
2. Document in prompts that abstract feature names may match loosely; verify on disk.

---

## Tool 3: `validate_against_specs`

### Original observed behavior (2026-05-18)

- MCP sometimes returned legacy MVP validator shape while REST returned structured
  findings (connector/runtime mismatch suspected).
- False `path_not_indexed` when SQLite had no chunks but LightRAG manifest did.

### Current behavior

- Structured validator: `findings`, `missing_evidence`, `confidence`, `checked_sources`.
- Ingestion persists prepared chunks to SQLite via `IngestionService`.
- Divergence warning: `metadata_lightrag_chunk_divergence` when evidence sources disagree.
- **`platform_runtime`** helps diagnose stale MCP executables.

### Remaining recommendations

1. Operator checklist: restart MCP after rebuild; confirm `platform_runtime` cwd
   and adapter mode match the dev server under test.
2. Re-ingest after index-format changes before treating `path_not_indexed` as real.

---

## Cross-cutting design (updated)

The platform now distinguishes more clearly:

| Signal | Where | Purpose |
| --- | --- | --- |
| Metadata chunks (SQLite) | `IngestionService` → `MetadataRepository` | Validation, UI index, trace linkage |
| LightRAG manifest | Sidecar per project | Retrieval ranking and semantic query |
| Manifest naive ranking | `/v1/search` with `naive` | Cheap, bounded discovery |
| Source diversity | All `/v1/search` result paths | Prevent one `source_path` from dominating |
| `lightrag_query_ready` / `lightrag_pipeline_busy` | Deep health | Distinguish storage OK vs semantic-ready |

Ingestion job **completed** still does not guarantee immediate semantic query
responsiveness; use **`naive`** or exact tools when the pipeline is busy.

---

## Acceptance criteria tracker

| AC# | Description | Status |
| --- | --- | --- |
| 1 | `search_docs` with `query_mode: "naive"` returns manifest-ranked results without calling `rag.query()`. | **Done** |
| 2 | `/v1/search` enforces server-side timeout for semantic query execution. | **Done** |
| 3 | Semantic search timeout returns fallback manifest candidates with warnings, not a hung request. | **Done** |
| 4 | `get_related_code` returns code/test source summary candidates while semantic query is unavailable. | **Done** (defaults to naive) |
| 5 | MCP schemas expose existing retrieval scope and budget fields additively. | **Done** |
| 6 | HTTP/core ingestion persists canonical chunks into SQLite metadata. | **Done** |
| 7 | `validate_against_specs` no longer reports `path_not_indexed` for paths retrievable by `get_document`. | **Partial** |
| 8 | `validate_against_specs` returns the same structured result shape through REST and MCP. | **Done** (verify connector runtime if shape differs) |
| 9 | Runtime identity information is available for MCP/API diagnostics. | **Done** (`platform_runtime`, health `runtime`) |
| 10 | Health/readiness output distinguishes storage health, manifest readiness, and query readiness. | **Done** (deep health fields) |
| 11 | Source-diversity cap (max 2 per `source_path`) on all `/v1/search` paths. | **Done** |
| 12 | Enriched code summaries (`basename`, `path_tokens`, `primary_symbol`) for discovery. | **Done** |

---

## Non-goals (unchanged)

- Do not add a new retrieval service.
- Do not make full LightRAG semantic query mandatory for agent source-file discovery.
- Do not reintroduce full source-file bodies into LightRAG just to improve search recall.
- Do not treat `/health` success alone as proof that semantic query tools are ready.

## Suggested next SPDD slice

If broad naive search should rank `ingestion-service.ts` above sibling
`ingestion-chunking/*` files for two-term queries, add a small **basename /
primary_symbol scorer bonus** in shared TS/Python ranking — without changing MCP
or REST schemas.
