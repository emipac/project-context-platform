# Backend HTTP Contract v1

The TypeScript platform talks to LightRAG and Graphiti through HTTP only. Python
services own vendor packages, graph database drivers, indexing stores, and LLM or
embedding configuration.

All calls include `x-project-id` and a matching `project_id` field in JSON bodies.
All outward errors should use:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Safe human summary.",
  "details": {},
  "project_id": "demo",
  "retryable": false
}
```

## LightRAG

Base URL: `LIGHTRAG_BASE_URL`, default `http://127.0.0.1:9621`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Dependency and capability health check |
| `GET` | `/v1/storage/health` | Inspect LightRAG persisted JSON storage health for a project |
| `POST` | `/v1/ingest` | Ingest workspace-relative paths |
| `POST` | `/v1/documents` | List indexed chunk records with filters and pagination |
| `POST` | `/v1/search` | Search canonical chunks |
| `POST` | `/v1/spec-context` | Retrieve spec context |
| `POST` | `/v1/related-code` | Retrieve code/test chunks |
| `POST` | `/v1/requirement-sources` | Retrieve chunks by requirement ID |
| `POST` | `/v1/document` | Retrieve full chunk content by chunk ID or source path |
| `DELETE` | `/v1/projects/{project_id}` | Contract mode deletes legacy `<safe>-chunks.json` under `LIGHTRAG_DATA_DIR`. Core mode finalizes cached LightRAG engines for the project, deletes `LIGHTRAG_DATA_DIR/projects/<safe-id>/`, and removes legacy chunk JSON when present (`deleted`: whether storage was removed) |

`/v1/ingest` accepts workspace-relative `paths` and may include `documents`
with optional chunk metadata:

| Field | Type | Description |
| --- | --- | --- |
| `path` | string | Workspace-relative source path |
| `content` | string | Chunk or full-file text |
| `stable_ids` | string[] | Stable IDs whose content is indexed in this payload |
| `heading` | string? | Nearest section heading when known |
| `chunk_id` | string? | Deterministic chunk identity when provided |
| `chunk_kind` | string? | `file`, `markdown_section`, `stable_id_anchor`, or `markdown_table_row` |
| `chunk_index` | number? | Zero-based order within `source_path` |
| `chunk_total` | number? | Total chunks prepared for that path in this ingest |
| `line_start` / `line_end` | number? | One-based line span in the source file |
| `content_hash` | string? | SHA-256 of `content` for reconciliation |

Multiple `documents` entries may share the same `path` (Markdown granular chunks). Omitted optional fields remain backward compatible.

`/v1/documents` lists indexed chunk records directly, without semantic search ranking.
It accepts `project_id`, optional `limit`, `offset`, `status` (`current`, `stale`,
or `all`), optional `chunk_kind`, `order_by` (`updated_at`, `created_at`,
`source_path`, or `chunk_index`), and `order` (`asc` or `desc`). Responses return
`{ "chunks": CanonicalDocumentChunk[], "total": number, "limit": number, "offset": number }`.

`GET /v1/storage/health?project_id=<id>&deep=true` validates sidecar-owned
LightRAG storage files. A shallow report (`deep=false`) returns
`status: "unchecked"` and `json_validated: false` while listing project JSON stores,
sizes, modification times, and disk usage without parsing large files. A deep report
parses each JSON file and returns `status: "ok"` or `status: "corrupt"` with
`corrupt_files` entries when malformed derived index files such as
`vdb_entities.json` would break ingestion or retrieval. Platform REST exposes this as
`GET /api/projects/:project_id/storage/health`; the Context Health UI calls it only
on demand.

Search and selector document responses return `{ "chunks": CanonicalDocumentChunk[] }`.
`/v1/ingest` responses return `{ "indexed": number, "warnings": string[] }`.

`POST /v1/search` and `POST /v1/related-code` accept a shared optional budget beyond `project_id` and `query` (related-code) / `query` (search):

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `limit` | int | `10` | Final result cap after ranking; must be 1–500. Ranking applies a source-diversity cap (default **2** chunks per `source_path`) after score sort, with backfill to reach `limit` when additional candidates exist. |
| `document_types` | string[]? | — | Manifest / filter slice (e.g. `prd`, `srs`, `code`, `test`, `doc`) |
| `source_path_prefixes` | string[]? | — | Keep chunks whose `source_path` starts with one prefix |
| `chunk_kinds` | string[]? | — | `file`, `markdown_section`, `stable_id_anchor`, `markdown_table_row` |
| `query_mode` | string? | engine default | `naive`, `local`, `hybrid`, `mix`, `global` (core engine only; contract treats `naive` as manifest/keyword) |
| `top_k` | int? | from `LIGHTRAG_TOP_K` | Core only; rejected if above sidecar cap |
| `chunk_top_k` | int? | from `LIGHTRAG_CHUNK_TOP_K` | Core only; rejected if above sidecar cap |
| `max_total_tokens` | int? | from `LIGHTRAG_MAX_TOTAL_TOKENS` | Core only; rejected if above sidecar cap |

Unsafe budgets (`limit` out of range, `top_k` / `chunk_top_k` / `max_total_tokens` beyond configured caps, or `max_total_tokens` &lt; 1000) return HTTP 400 with `VALIDATION_ERROR`. Callers that omit new fields keep legacy behavior.

### Composer retrieval modes (`prepare_feature_context`)

The MCP tool `prepare_feature_context` and `POST /api/projects/:project_id/context/feature` accept optional `retrieval_mode`, `document_types`, `source_path_prefixes`, and `chunk_kinds`, plus optional requirement narrowing (`requirement_ids` on MCP; **`optional_requirement_ids`** in the REST JSON body) and optional task id (`task_id` on MCP; **`optional_task_id`** in REST).

| Mode | Behavior |
| --- | --- |
| `fast` (default) | Exact requirement sources, manifest/keyword discovery (`query_mode: naive`), and Graphiti facts only. No scoped semantic (`local`/`hybrid`) search and no `getRelatedCode` sidecar calls. |
| `semantic` | Same cheap stages, then one scoped semantic docs search with bounded tokens/time (`retries: 0` on that call). |
| `deep` | Cheap stages, then two scoped semantic calls (docs via `/v1/search`, code/tests via `/v1/related-code`) **in parallel**, each with the same per-call budget so wall time is one semantic timeout, not two sequential timeouts. |

Escalate to `semantic` or `deep` only when cheap narrowing is insufficient.

### Platform MCP (stdio) vs platform REST

Parameter schemas for MCP tools live in `packages/mcp-server/src/server.ts`; handlers in `packages/mcp-server/src/register-all-tools.ts`.

| Surface | Behavior |
| --- | --- |
| `POST /api/projects/:project_id/search` | Forwards the LightRAG budget in the table above to the sidecar (`limit` **1–500** when set). Returns **full** `CanonicalDocumentChunk` bodies from retrieval. |
| MCP `search_docs` | Same optional budget keys as the sidecar, but results are **preview-shaped**: each row includes `preview` (truncated text), `content_length`, `truncated`, and chunk metadata—not necessarily full `content`. MCP **`limit` is clamped** (default **5**, maximum **10**); see `packages/mcp-server/src/preview.ts`. |
| MCP `get_related_code` | Same preview clamp and budget forwarding as `search_docs`. There is **no** dedicated related-code REST route; agents use MCP or compose flows. |
| MCP `get_requirement_sources` | Same preview shaping as `search_docs` / `get_related_code` (full chunks from LightRAG are summarized for the MCP response). |
| MCP `get_document` | Full chunk payloads (no preview wrapper), consistent with full-document retrieval. |
| MCP `platform_runtime` | Returns Node process / adapter identity **without** calling LightRAG or Graphiti—similar to the `runtime` object on platform `GET /health`. |
| `POST /api/projects/:project_id/context/review` | Body: optional `changed_files`, `diff` only—matches MCP `prepare_review_context`. |
| `POST /api/projects/:project_id/ingest/changed` | Body: optional `paths`—matches MCP `ingest_changed_files`. |

SPDD HTTP mirrors MCP behavior: `record_spdd_run` / `POST .../spdd-trace/runs` require a non-empty **`summary`** capped at **1000** characters; `lookup_spdd_trace` / `GET .../spdd-trace/lookup` requires at least one of **`stable_id`**, **`source_path`**, **`chunk_id`**, **`feature_ref`**, or paired **`target_type`** + **`target_id`** (trace **`link_id`** is not a lookup key).

`LIGHTRAG_BACKEND=contract` keeps the current JSON/keyword implementation.
`LIGHTRAG_BACKEND=core` is the explicit switch for real LightRAG behavior; an
LLM provider key alone must not activate core mode. In core mode, the sidecar
uses a per-project LightRAG working directory plus a PCP manifest to preserve
`CanonicalDocumentChunk` source paths, headings, stable IDs, document types, and
delete/reindex state.

`/v1/ingest` includes `mode` values aligned with platform ingestion jobs (`full`,
`changed`, `document`). In core mode the mode drives reconciliation: changed/document
runs reconcile only for paths included in the payload (skipped hashes avoid duplicate
embedding work); full compares manifest paths against the current scanned path list,
attempts LightRAG deletes for removed paths, and clears stale manifest records after
those deletes. **Whole-project cleanup stays on `DELETE /v1/projects/{project_id}`**
(platform deletion flows call this route); document-level deletes belong inside ingest
reconciliation rather than project deletion services.

LightRAG sidecar `/health` responses remain additive and inexpensive (no provider calls).
They include retrieval diagnostics such as `query_mode`, `llm_model`,
`embedding_model`, `embedding_dim`, and `tuning` (`max_async`, `max_parallel_insert`,
`top_k`, `chunk_top_k`, `max_total_tokens`) plus a shallow `storage_health` summary.
`/health?project_id=<id>` scopes that storage summary to one project; `deep=true`
performs the same JSON validation as `/v1/storage/health` when explicitly requested.
Conservative defaults apply when env vars are unset or invalid.

Example LightRAG capability payload:

```json
{
  "status": "ok",
  "engine": "lightrag",
  "contract": "pcp-v1",
  "backend": "core",
  "query_mode": "hybrid",
  "llm_model": "gpt-4o-mini",
  "embedding_model": "text-embedding-3-small",
  "embedding_dim": 1536,
  "tuning": {
    "max_async": 4,
    "max_parallel_insert": 2,
    "top_k": 40,
    "chunk_top_k": 16,
    "max_total_tokens": 20000
  },
  "storage_ready": true,
  "migration_available": false,
  "core_implemented": true
}
```

## Graphiti

Base URL: `GRAPHITI_BASE_URL`, default `http://127.0.0.1:8091`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Dependency and capability health check |
| `POST` | `/v1/memory/decisions` | Persist decision memory |
| `POST` | `/v1/memory/reviews` | Persist review finding memory |
| `POST` | `/v1/memory/requirement-changes` | Persist requirement change memory |
| `POST` | `/v1/memory/implementation-summaries` | Persist implementation summary memory |
| `POST` | `/v1/approvals` | Persist human approval memory |
| `POST` | `/v1/facts/current` | Retrieve current facts |
| `POST` | `/v1/history` | Retrieve temporal history |
| `DELETE` | `/v1/projects/{project_id}` | Remove project memory JSON (`deleted_events`) and, when `GRAPHITI_BACKEND=core`, purge Neo4j nodes keyed by workspace isolation fields (`deleted_graph`) |

The Graphiti service must keep namespace isolation by treating `project_id` as the
Graphiti namespace key. Neo4j/FalkorDB credentials and any Cypher/driver logic
stay inside the Python service.

`GRAPHITI_BACKEND=contract` keeps the current JSON memory implementation.
`GRAPHITI_BACKEND=core` is the explicit switch for real Graphiti behavior; an LLM
provider key alone must not activate core mode. In core mode, memory writes are
stored as Graphiti JSON episodes with `group_id=project_id`; JSON event files
remain audit/history ledgers and migration inputs.

Health responses are additive and may include:

```json
{
  "status": "ok",
  "engine": "graphiti",
  "contract": "pcp-v1",
  "backend": "contract",
  "llm_configured": false,
  "embedding_configured": true,
  "storage_ready": true,
  "graph_ready": true,
  "migration_available": false
}
```

`DELETE /v1/projects/{project_id}` follows the same `x-project-id` rules as other routes (when supplied, it must equal `{project_id}`).

## Local Adapter Fallback

`PCP_ADAPTER_MODE=local` bypasses the Python services and uses the existing
TypeScript local adapters:

- `LocalLightRagAdapter`: indexes workspace files into SQLite-backed chunks and
  performs simple term matching.
- `LocalGraphitiAdapter`: writes temporal memory to a local JSON file.

This mode is for development and tests only. It does not provide real LightRAG or
Graphiti semantics.

## Platform REST — Context Observability

The Fastify API serves derived observability endpoints backed only by project SQLite
metadata and MCP tool-call logs (no additional graph database):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/:project_id/context/freshness` | Freshness report (`changed_file_detection`, `include_stale`) |
| `GET` | `/api/projects/:project_id/context/quality` | Quality metrics |
| `GET` | `/api/projects/:project_id/context/graph` | Derived graph snapshot or anchored neighborhood |

### Context graph (`GET .../context/graph`)

Query parameters:

| Parameter | Meaning |
| --- | --- |
| `include_stale` | When `true`, include stale chunks and stale trace rows in the snapshot inputs. |
| `limit` | Hard cap on returned edges after ordering (clamped server-side). |
| `types` | Comma-separated node `type` filter; `project` always included. Anchored roots stay visible even if their type is omitted. Aliases: `run`→`spdd_run`, `artifact`→`spdd_artifact`, `feature`→`feature_ref`. |
| `mode` | `snapshot` (ignore anchors) or `anchored` (require `root_type`/`root_id` or one shortcut). Omitted: `anchored` if any anchor field is present, else snapshot. |
| `root_type` / `root_id` | Public root kind (`run`, `artifact`, `source_path`, `stable_id`, `feature`) plus identifier (run id, artifact id or path, workspace-relative path, stable id, feature label). |
| `depth` | Edge hops from resolved roots (`0`–`4`, default `2`) when anchored. |
| `edge_types` | Comma-separated allow-list (`project_path`, `path_chunk`, `chunk_stable`, `path_registry`, `path_spdd_artifact`, `artifact_run`, `path_run`, `project_run`, `run_trace`). |
| `status` | Comma-separated trace link statuses; applies to `run_trace` edges. Must not include `stale` unless `include_stale=true`. |
| `relation` | Comma-separated trace relations; applies only to `run_trace` edges. |
| `ordering` | `default`, `newest_runs_first`, `unresolved_first`, `stable_id_anchored_first` (ordering runs before `limit`). |
| `run_id`, `artifact_path`, `source_path`, `stable_id`, `feature_ref` | Shortcut anchors (at most one unless paired with matching `root_type`/`root_id`). |

Warnings may include machine-oriented codes such as `GRAPH_ROOT_NOT_FOUND`, `GRAPH_TRUNCATED_BY_LIMIT`, `GRAPH_AMBIGUOUS_STABLE_ID`.

These augment existing compose endpoints (`POST .../context/feature`, `POST .../context/review`) and do not replace LightRAG or Graphiti HTTP contracts above.
