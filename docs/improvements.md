**Key Findings**
`get_spec_context` is the biggest offender. Calling it for `REQ-MCP-001` returned the whole 102k-character SRS chunk plus hundreds of stable IDs. The root cause is that LightRAG currently stores whole documents as single records, then `get_spec_context` returns the matching record unchanged. See [lightrag_engine.py](/Users/emipac/www/minic/pcp/services/lightrag/lightrag_engine.py:286), [lightrag_engine.py](/Users/emipac/www/minic/pcp/services/lightrag/lightrag_engine.py:324), and [lightrag_engine.py](/Users/emipac/www/minic/pcp/services/lightrag/lightrag_engine.py:619).

`prepare_feature_context` is currently too broad and not using explicit IDs well. It does `searchDocs(feature_name, limit: 8)` and `getRelatedCode(feature_name, limit: 8)`, then returns full chunks and flatMaps every stable ID from those chunks into traceability. That is why one broad SRS hit explodes the output. See [context-composer-service.ts](/Users/emipac/www/minic/pcp/packages/core/src/services/context-composer-service.ts:14) and [context-composer-service.ts](/Users/emipac/www/minic/pcp/packages/core/src/services/context-composer-service.ts:36).

`search_docs`, `get_related_code`, and `get_requirement_sources` are safer because MCP wraps them with previews, but the preview still includes the full `stable_ids` array. For big SRS chunks, that metadata alone becomes expensive. See [preview.ts](/Users/emipac/www/minic/pcp/packages/mcp-server/src/preview.ts:31) and [preview.ts](/Users/emipac/www/minic/pcp/packages/mcp-server/src/preview.ts:39).

`list_stable_ids` is useful for humans but the wrong primitive for agents generating new IDs. It defaults to 200 rows, and even with filters it makes the agent inspect history instead of asking for “next safe IDs.” See [id-registry-service.ts](/Users/emipac/www/minic/pcp/packages/core/src/services/id-registry-service.ts:13) and [id-registry-service.ts](/Users/emipac/www/minic/pcp/packages/core/src/services/id-registry-service.ts:99).

`get_current_facts` and `get_history` return raw Graphiti-ish records with UUIDs, node IDs, null embeddings, etc. The actual useful part is usually just `fact`, status, time, and related source. Good content, noisy envelope.

**Highest-Value Improvements**
1. Add an output budget contract to all read tools: `detail: "summary" | "preview" | "full"`, `max_chars`, `include_content`, `include_stable_ids`, and `stable_id_limit`. Default should be `summary` or compact `preview`, never full chunks.

2. Fix indexing granularity. Markdown docs should be split by heading/section and stable-ID anchors, not stored as one record per file. `get_spec_context(REQ-MCP-001)` should return the exact section/table row containing that ID, plus optional neighbor sections only when requested.

3. Replace `list_stable_ids` for generation workflows with purpose-built tools:
`plan_stable_ids` or `allocate_stable_ids` should accept `{category, domain, count, purpose, source_path}` and return compact proposed IDs like `REQ-MCP-012..014`.
`validate_stable_id_batch` should accept proposed IDs and return conflicts only.
`stable_id_ranges` should return compact occupied ranges and next available IDs by category/domain, not rows.

4. Add optional ID reservation. Since multiple local agent chats can exist, `allocate_stable_ids(reserve: true)` should write a short-lived reservation into SQLite. Later ingestion can mark reservations fulfilled. That prevents two fresh agents from both choosing the same “next” ID before either document is indexed.

5. Redesign `prepare_feature_context` as a staged catch-up tool. It should return a compact project primer, top requirements, related source files, relevant decisions/history, and suggested follow-up calls. Full content should be behind explicit `get_document` or `get_spec_context(detail:"full")`.

6. Make `get_ingestion_status` default to a compact health summary. Right now it returned many jobs and repeated duplicate warnings. Default should be latest job, stale/index counts, duplicate summary, and `recent_jobs_limit` only when requested.

**My Recommended Tool Shape**
For a new no-context agent fixing a bug, the ideal flow should be:

1. `prepare_work_context({task: "...", mode: "bugfix", budget: "small"})`
Returns project summary, likely files, relevant stable IDs, current risks, and next suggested tool calls.

2. `get_related_code({query, limit: 5, detail: "preview"})`
Returns ranked files with why they matched, symbols/headings, short snippets, and tests.

3. `get_spec_context({spec_id, detail: "focused"})`
Returns only the exact requirement/section, with `source_path`, line range, and neighbors only if asked.

4. `get_current_facts({topic, detail: "facts"})`
Returns concise facts, not raw graph rows.

5. `allocate_stable_ids({requests:[...], reserve:true})`
Returns validated IDs before document generation, without listing the registry.

So the priority is not adding a new MCP surface. It is tightening the existing tools around context budgets, section-level indexing, exact-ID retrieval, and ID allocation. That will make the system feel like an experienced teammate handing the agent the five things it needs, instead of a filing cabinet tipped onto the desk.


**SPDD trace is basically healthy; context graph is useful but should not be the default “agent catch-up” tool unless anchored or filtered.**

**What I found**
- `list_spdd_trace` / `lookup_spdd_trace` are compact compared with docs. A lookup by `packages/mcp-server/src/register-all-tools.ts` returned 3 links/runs, which is good agent-sized context.
- `get_context_graph` has good filters now: `mode: anchored`, root shortcuts, `edge_types`, `status`, `relation`, and ordering are implemented in [context-observability-service.ts](/Users/emipac/www/minic/pcp/packages/core/src/services/context-observability-service.ts:314).
- The bad default is snapshot graph. With `limit:10`, it returned only `project_path` and `path_registry` edges, no SPDD trace, because registry edges dominate early output.
- Worse: `types:['spdd_run','spdd_artifact','feature_ref']` returned only the project node, because type filtering happens after truncation at [context-observability-service.ts](/Users/emipac/www/minic/pcp/packages/core/src/services/context-observability-service.ts:519) and [context-observability-service.ts](/Users/emipac/www/minic/pcp/packages/core/src/services/context-observability-service.ts:531).
- Anchored graph works well. `feature_ref:'MCP context graph'` returned the relevant SPDD artifact, run, feature refs, and changed source paths.
- `get_context_quality_metrics` is already a good compact health tool. It reported duplicate IDs and unresolved source-path trace links without huge payloads.

**Efficiency Risks**
- `get_context_graph` always loads a full snapshot first: jobs, chunks, registry, SPDD artifacts, runs, links, and tool calls at [context-observability-service.ts](/Users/emipac/www/minic/pcp/packages/core/src/services/context-observability-service.ts:558). So even anchored calls are output-cheap but not necessarily compute-cheap.
- Current project has `1,263` registry rows but only `46` SPDD trace links, so default graph is registry-heavy before it becomes trace-useful.
- `lookup_spdd_trace` is conceptually good, but SQLite applies some useful filters in memory after fetching rows, especially `source_path`, `stable_id`, `chunk_id`, and `feature_ref` in [sqlite-metadata-repository.ts](/Users/emipac/www/minic/pcp/packages/infra/src/sqlite-metadata-repository.ts:273).

**Recommended Changes**
- Make `get_context_graph` default to agent-useful behavior: either require an anchor for MCP, or default snapshot to `edge_types:['run_trace','artifact_run']`.
- Apply `types` before truncation, or derive edge candidates from requested node types before `limit`.
- Add scoped repository methods for graph roots so anchored graph does not load every registry row.
- Optimize SPDD trace lookup SQL by mapping exact filters to indexed `target_type,target_id` where possible.
- Add a compact `summary`/`group_by_run` mode for `list_spdd_trace`, so broad listing returns recent runs plus counts rather than three independent arrays.

So yes, SPDD trace is in much better shape than `get_spec_context` and `prepare_feature_context`. The graph tool just needs its default/query semantics tightened so agents don’t accidentally ask for a “map of everything” and receive the least relevant first 200 edges.