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
| `POST` | `/v1/ingest` | Ingest workspace-relative paths |
| `POST` | `/v1/search` | Search canonical chunks |
| `POST` | `/v1/spec-context` | Retrieve spec context |
| `POST` | `/v1/related-code` | Retrieve code/test chunks |
| `POST` | `/v1/requirement-sources` | Retrieve chunks by requirement ID |
| `POST` | `/v1/document` | Retrieve full chunk content by chunk ID or source path |
| `DELETE` | `/v1/projects/{project_id}` | Contract mode deletes legacy `<safe>-chunks.json` under `LIGHTRAG_DATA_DIR`. Core mode finalizes cached LightRAG engines for the project, deletes `LIGHTRAG_DATA_DIR/projects/<safe-id>/`, and removes legacy chunk JSON when present (`deleted`: whether storage was removed) |

`/v1/ingest` accepts workspace-relative `paths` and may include `documents`
with `{ "path": string, "content": string, "stable_ids": string[], "heading"?: string }`
so contract-mode sidecars can index actual file content even when they cannot
read the host workspace directly.

Search and document responses return `{ "chunks": CanonicalDocumentChunk[] }`.
`/v1/ingest` responses return `{ "indexed": number, "warnings": string[] }`.

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
`top_k`, `chunk_top_k`, `max_total_tokens`). Conservative defaults apply when env vars
are unset or invalid.

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
