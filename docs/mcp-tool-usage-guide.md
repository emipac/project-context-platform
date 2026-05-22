# PCP MCP Tool Usage Guide

This guide describes how agents should use the PCP MCP tools to discover project context, retrieve exact specification evidence, inspect implementation history, and record completed work with minimal token and latency cost.

The default strategy is: exact and metadata-backed tools first, semantic retrieval only after the scope is narrowed.

**Source of truth:** tool names and accepted parameters are declared in `packages/mcp-server/src/server.ts` (handlers in `register-all-tools.ts`).

## Retrieval Principles

1. Prefer exact identifiers over semantic search when a stable ID, source path, artifact path, chunk ID, feature ref, or task ID is available.
2. Use `prepare_feature_context` in `fast` mode by default. Escalate to `semantic` or `deep` only when exact and manifest context is not enough.
3. Use `search_docs` for broad discovery, not as the first step when exact anchors exist.
4. Use memory tools for temporal facts, decisions, and implementation summaries; use LightRAG tools for indexed document and code context.
5. Use SPDD trace tools when the question is about prompts, generated analysis, implementation runs, changed files, or why a change exists.
6. Keep tool calls scoped: pass `project_id`, scope hints (`document_types`, `source_path_prefixes`, `chunk_kinds`), and retrieval budgets when the tool supports them. For **`prepare_feature_context`**, optional **`requirement_ids`** narrow exact sources; other tools use their own parameter names (see `server.ts`).
7. **`search_docs`**, **`get_related_code`**, and **`get_requirement_sources`** return **preview rows** (`preview`, `content_length`, `truncated`, metadata)—not full chunk text for every hit. Their **`limit`** is **clamped** (default **5**, max **10**). Optional LightRAG budgets still apply: `document_types`, `source_path_prefixes`, `chunk_kinds`, `query_mode`, `top_k`, `chunk_top_k`, `max_total_tokens`, `timeout_ms`, `retries` (`packages/mcp-server/src/preview.ts`). Use **`get_document`** or **`get_spec_context`** when you need full indexed content.
8. Treat warnings as first-class context. Partial results with warnings are usually better than retrying broad semantic queries.

## Tool Categories

### Project Bootstrap

Use these before writing requirements, SPDD artifacts, stable IDs, or project documentation.

| Tool | Use when | Notes |
|---|---|---|
| `get_documentation_guidelines` | You need canonical docs, stable ID rules, documentation conventions, or memory policy. | First call for documentation, requirements, ADR, SPDD, and stable-ID tasks. |
| `get_ingestion_status` | You need to know whether the index is current or a recent ingestion failed. | Use before assuming retrieval misses mean missing source content. |
| `get_context_freshness` | You need index freshness or git-vs-index drift signals. | Metadata-backed; does not require LightRAG semantic search. |
| `get_context_quality_metrics` | You need quality/health metrics for indexed context and tool-call behavior. | Useful for MCP/tool reliability diagnostics. |
| `platform_runtime` | You need Node process / adapter-mode diagnostics without hitting LightRAG. | Same kind of identity as `runtime` on platform `GET /health`; use when MCP routing or adapter mode is unclear. |

### Exact Specification Retrieval

Use these when the user gives a stable ID or when another tool returns one.

| Tool | Use when | Notes |
|---|---|---|
| `get_spec_context` | You need the exact chunk containing a requirement, ADR, task, AC, or other stable ID. | Default `include_neighbors=false` for surgical retrieval; use neighbors only when local context is insufficient. |
| `get_requirement_sources` | You need all indexed source chunks connected to one requirement ID. | Can be slower than `get_spec_context`; use after exact chunk retrieval when traceability matters. |
| `get_document` | You need indexed chunks for a known `source_path` or `chunk_id`. | Returns **full** chunk payloads from retrieval (not preview-truncated MCP rows). Markdown returns indexed section/table content; non-Markdown files are compact **summary cards** (`path`, `basename`, `path_tokens`, `primary_symbol`, symbols, hash)—read from disk when you need complete source. |
| `list_stable_ids` | You need occupied ID ranges before creating new stable IDs. | Read-only lookup; optional filters: `category`, `domain`, `source_path`, `status`, `include_stale`, `include_aliases`, `limit` (see `server.ts`). |
| `validate_ids` | You need duplicate/stale stable-ID health. | Use before and after modifying docs with stable IDs. |

### Feature And Code Discovery

Use these to bootstrap implementation context without exhaustively reading the repository.

| Tool | Use when | Notes |
|---|---|---|
| `prepare_feature_context` | You have a feature, bug, architecture area, task, or requirement set and need implementation context. | Default mode is `fast`: optional **`requirement_ids`**, naive manifest discovery over docs and code/test slices, Graphiti facts, **no** semantic/`related-code` stage until `semantic`/`deep`. |
| `get_related_code` | You need code/test candidates for a named concept after narrowing the feature terms. | Preview-shaped rows with MCP **`limit`** clamp (**default 5**, **max 10**); pass **`feature_name`** or **`requirement_id`**. Verify hits on disk before editing. |
| `search_docs` | You need broad indexed discovery across docs/code and do not have exact anchors. | Preview **`limit`** clamp applies; keep queries specific and follow stable IDs/paths with **`get_spec_context`** / **`get_document`**. Results use source-diversity ranking (max **2** chunks per `source_path` before the final limit). For implementation files, prefer **`get_related_code`** or scoped search with **`document_types`** / **`source_path_prefixes`**, then read from disk. |
| `prepare_review_context` | You have changed files or a diff and need review context. | Parameters: optional **`changed_files`**, **`diff`** only (no requirement-ID list on this tool—use **`validate_against_specs`** or **`prepare_feature_context`** for ID-scoped work). |
| `validate_against_specs` | You need an evidence-oriented check for a plan/diff against requirements, paths, SPDD artifacts, trace links, freshness, and temporal memory. | Deterministic heuristics only (`fast`/`strict`); returns findings, `missing_evidence`, and `confidence` — not proof of correctness. |

### Memory And History

Use these for temporal knowledge that may not live in canonical docs.

| Tool | Use when | Notes |
|---|---|---|
| `get_current_facts` | You need current decisions, facts, or implementation state for a focused topic. | Query narrow topics such as `LightRAG`, `prepare_feature_context`, `SPDD trace`, or a feature name. |
| `get_history` | You need prior facts, deprecated context, or how a decision changed over time. | Use `include_deprecated=true` when investigating regressions or historical behavior. |
| `remember_implementation_summary` | You completed meaningful non-SPDD work and need to store a summary. | Prefer `record_spdd_run` for SPDD implementations because it can mirror to memory. |
| `remember_decision` | A durable project decision was made. | For major architecture decisions, also update or create an ADR. |
| `remember_requirement_change` | A requirement changed. | Also update the canonical requirement document. |
| `remember_review` | You completed a review and need to record findings/status. | Use for durable review findings, not casual observations. |
| `remember_approval` | A human approved or rejected a high-risk object. | Use when approval state matters for traceability. |

### SPDD Trace

Use these when work is driven by SPDD analysis, prompts, plans, reviews, or implementation runs.

| Tool | Use when | Notes |
|---|---|---|
| `sync_spdd_artifacts` | You created or changed files under `spdd/prompt`, `spdd/analysis`, `spdd/plan`, or `spdd/review`. | Sync before trace lookup or recording runs. |
| `list_spdd_trace` | You need artifacts, runs, or trace links for a prompt/artifact/source/stable ID. | Good first trace query when you know an `artifact_path`. |
| `lookup_spdd_trace` | You need reverse lookup by stable ID, source path, chunk ID, feature ref, or typed target. | Supply at least one of **`stable_id`**, **`source_path`**, **`chunk_id`**, **`feature_ref`**, or **`target_type`** + **`target_id`**. Trace **`link_id`** is not accepted as a lookup key. |
| `record_spdd_run` | You completed SPDD-driven implementation or review work. | **`summary`** is **required** and capped at **1000** characters server-side. Include artifact path/title, status, relation, paths, stable IDs, chunk IDs, feature refs, tool/memory IDs, and `mirror_to_memory=true` when appropriate. |

### Ingestion And Index Maintenance

Use these after source/doc changes or when retrieval does not reflect disk state.

| Tool | Use when | Notes |
|---|---|---|
| `ingest_document` | You changed or need to index one known file. | Best for targeted doc/source indexing. |
| `ingest_changed_files` | You changed multiple files or want the index to catch up with the current worktree. | Optional **`paths`** array; uses the active workspace when `project_id` is omitted. Use after implementation and before relying on retrieval for the new state. |
| `get_ingestion_status` | You need recent ingestion logs, skipped paths, or job status. | Use after ingestion warnings or UI/document-index discrepancies. |

### Context Observability

Use these to inspect MCP/index health rather than business context.

| Tool | Use when | Notes |
|---|---|---|
| `get_context_graph` | You need a bounded graph of artifacts, runs, stable IDs, files, chunks, or features. | Use anchored mode for a known root; snapshot mode for high-level inspection. |
| `get_context_freshness` | You need freshness/staleness signals. | Good for diagnosing stale document index rows. |
| `get_context_quality_metrics` | You need deterministic quality metrics and tool-call reliability signals. | Good for improving MCP behavior and finding expensive/noisy tools. |
| `platform_runtime` | Adapter mode or process identity is ambiguous. | Lightweight diagnostic; does not query LightRAG. |

## `prepare_feature_context` Modes

Use `fast` unless there is a clear reason to spend semantic retrieval budget.

| Mode | What it should do | Use when |
|---|---|---|
| `fast` | Exact requirement sources (when `requirement_ids` are passed), parallel **naive** manifest search over docs and code/test slices, and Graphiti facts—**no** scoped semantic (`local`/`hybrid`) stage and **no** `/v1/related-code` calls (`deep` uses semantic search for code via that path). | Default for new feature, bug, and architecture questions. |
| `semantic` | `fast` plus one scoped semantic docs query with lower budgets. | Use after exact/manifest context is insufficient and you can provide scope hints. |
| `deep` | `fast` plus scoped semantic docs and code/test retrieval in parallel. | Use only for complex cross-cutting work after narrowing terms and paths. |

Recommended scope hints:

- `requirement_ids`: pass known stable IDs whenever available.
- `document_types`: use `["prd", "srs", "adr", "doc"]` for documentation and `["code", "test"]` for implementation candidates.
- `source_path_prefixes`: pass known folders such as `packages/core/src/`, `packages/web/src/`, or `services/lightrag/`.
- `chunk_kinds`: use `markdown_table_row`, `stable_id_anchor`, or `markdown_section` when looking for documentation anchors.

## Scenario Workflows

### New Feature Or Bug Investigation

1. Call `get_documentation_guidelines`.
2. If the user supplied stable IDs, call `get_spec_context` for each ID with `include_neighbors=false`.
3. Call `prepare_feature_context` with `retrieval_mode="fast"` and any known `requirement_ids`.
4. If code candidates are weak, call `search_docs` or `get_related_code` with narrower terms and a small `limit`.
5. Inspect the returned source files directly with targeted filesystem reads.
6. If context is still insufficient, retry `prepare_feature_context` with `retrieval_mode="semantic"` and explicit `document_types` / `source_path_prefixes`.

### SPDD Implementation

1. Call `sync_spdd_artifacts`.
2. Call `list_spdd_trace` for the SPDD prompt `artifact_path`.
3. Call `get_documentation_guidelines`.
4. Call `prepare_feature_context` in `fast` mode with requirement IDs from the prompt.
5. Call `get_spec_context` or `get_requirement_sources` for explicit IDs.
6. Call `get_current_facts` and `get_history` for the feature/topic.
7. Use `search_docs` only for unresolved gaps.
8. After implementation and tests, call `validate_against_specs`, `ingest_changed_files`, `validate_ids`, and `record_spdd_run`.

### Stable ID Creation Or Document Editing

1. Call `get_documentation_guidelines`.
2. Call `list_stable_ids` filtered by likely `category` and `domain`.
3. Call `validate_ids` to check duplicate health.
4. Edit documents with new IDs only after confirming the occupied range.
5. Call `ingest_document` or `ingest_changed_files`.
6. Call `validate_ids` again.

### Investigating Retrieval Or Index Problems

1. Call `get_ingestion_status`.
2. Call `get_context_freshness` and `get_context_quality_metrics`.
3. Call `get_document` for a known `source_path` or `chunk_id`.
4. Call `get_spec_context` for known stable IDs.
5. Use `search_docs` only to confirm whether the issue is query/ranking-related rather than indexing-related.
6. If SPDD artifacts are involved, call `sync_spdd_artifacts` and `lookup_spdd_trace`.

### Recording Completed Work

1. If work was SPDD-driven, use `record_spdd_run` with trace links and `mirror_to_memory=true`.
2. If work was not SPDD-driven, use `remember_implementation_summary`.
3. Use `remember_decision`, `remember_requirement_change`, or `remember_review` only for durable decisions, changed requirements, or review findings.

## Current Retrieval Behavior Notes

- `/v1/search` and MCP broad search apply **source-diversity ranking**: after score sort, at most **2** chunks per `source_path` enter the first pass; remaining slots backfill from other ranked candidates so results are not monopolized by one file.
- Non-Markdown code/test chunks are **summary cards** in the index (`basename`, `path_tokens`, `primary_symbol`, symbols, hash). Re-ingest after summary-format changes so discovery terms stay current.
- `prepare_feature_context` supports `retrieval_mode`, `document_types`, `source_path_prefixes`, `chunk_kinds`, optional `requirement_ids`, and optional `task_id`.
- `fast` uses naive manifest discovery for both docs and tests/code chunks; `semantic` adds one scoped semantic docs search; `deep` adds parallel semantic docs + related-code retrieval. None of these modes replace **`get_spec_context`** when you already have a stable ID.
- MCP **`list_spdd_trace`** / **`lookup_spdd_trace`** accept an optional **`limit`** clamped server-side (see handlers).
- REST **`POST /api/projects/:project_id/search`** returns **full** chunks and honors sidecar **`limit`** (1–500); MCP **`search_docs`** uses the **preview** layer and stricter **`limit`** clamp—do not assume parity when copying examples between HTTP and MCP.
- `get_spec_context` is the most reliable tool for stable-ID anchored context and returns granular Markdown chunks such as `markdown_table_row` and `stable_id_anchor`.
- `get_requirement_sources` returns preview-shaped MCP rows (same clamp/warning behavior as broad search tools).
- `get_related_code` honors the same preview **`limit`** clamp as `search_docs`; verify hits on disk before editing.
- If a scoped retrieval response includes unexpected chunks, treat it as candidate discovery, not authoritative filtering. Follow up with exact paths, stable IDs, **`get_document`**, and direct file reads.
