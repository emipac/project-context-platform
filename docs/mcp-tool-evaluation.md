# PCP MCP Tool Evaluation

This document evaluates the current PCP MCP retrieval and context tools based on live tool checks, the staged retrieval analysis, and the usage rules documented in `docs/mcp-tool-usage-guide.md`.

The main conclusion is mixed: exact and index-backed tools are now highly useful for surgical context retrieval, but broad semantic/discovery tools still have availability and relevance problems. Agents should treat exact ID/path retrieval as authoritative and semantic retrieval as candidate discovery until the remaining issues are fixed.

## Evaluation Scope

Inputs used:

- Live MCP tool calls against project `pcp`.
- `docs/mcp-tool-usage-guide.md`.
- `spdd/analysis/GGQPA-XXX-202605152109-[Analysis]-prepare-feature-context-staged-retrieval.md`.
- Recent ingestion status and stable-ID validation output.

Tools sampled:

| Tool | Observed result | Accuracy | Usefulness | Caveat |
|---|---:|---|---|---|
| `get_documentation_guidelines` | Success, sub-second | High | High | Static guidance only; not implementation context. |
| `get_document` | Success, sub-second by exact path | High | High | Requires known path/chunk anchor. |
| `get_spec_context` | Success, exact granular chunks | High | High | Duplicate stable IDs can return multiple exact chunks. |
| `get_requirement_sources` | Success but slow in one sample | High | Medium | Useful traceability, but latency can be high. |
| `get_ingestion_status` | Success | High | High | Verbose historical payload; needs UI/API summarization for common checks. |
| `validate_ids` | Success but slow and known duplicate warnings | High | Medium | Reports known pre-existing duplicates; noisy if used during unrelated work. |
| `get_current_facts` | Success, often empty | Medium | Medium | Empty responses are ambiguous: no fact, graph miss, or topic mismatch. |
| `get_history` | Success, often empty | Medium | Medium | Same ambiguity as current facts. |
| `prepare_feature_context` | One earlier success, latest `BACKEND_UNAVAILABLE` in fast mode | Medium when available | Potentially high | Current reliability is not acceptable for default agent bootstrap. |
| `get_related_code` | One earlier success with weak relevance, latest `BACKEND_UNAVAILABLE` | Low to medium | Medium | Candidate discovery only; must be verified manually. |
| `search_docs` | One earlier success, later repeated `BACKEND_UNAVAILABLE` | Medium when available | Medium | Broad semantic retrieval is currently intermittent. |

## Observed Metrics

These are practical operating metrics from the recent checks, not statistically complete benchmarks.

| Metric | Current observation | Target |
|---|---:|---:|
| Exact path retrieval success | `get_document` succeeded consistently in sampled calls | >= 99% |
| Exact stable-ID retrieval success | `get_spec_context` for a known MCP requirement ID succeeded and returned granular chunks | >= 99% |
| Broad semantic retrieval availability | `search_docs` succeeded once, then failed repeatedly with `BACKEND_UNAVAILABLE` | >= 95% |
| Feature context availability | `prepare_feature_context fast` succeeded earlier, failed in latest sample | >= 95% |
| Related-code availability | Mixed success/failure in sampled calls | >= 95% |
| Exact retrieval latency | Sub-second in latest path/spec checks | p95 < 1s |
| Requirement source latency | One sampled call around tens of seconds | p95 < 3s |
| Semantic/discovery timeout behavior | Failures surfaced around the MCP/backend timeout boundary | p95 < 8s for fast mode |
| Relevance of related-code candidates | Returned unrelated ID registry/SPDD trace services for prepare-context query | Top-5 precision >= 80% |
| Duplicate stable-ID noise | Known duplicate warnings repeated in ingestion/validation | Zero unrelated duplicate warnings in scoped workflows |

## Impact-Ranked Findings

### Critical Impact

#### `prepare_feature_context fast` still depends on a failing retrieval path

Problem:

- The staged retrieval design says `fast` mode should be safe, cheap, and deterministic.
- The latest live call to `prepare_feature_context` with `retrieval_mode="fast"` returned `BACKEND_UNAVAILABLE`.
- This means the tool is still not safe enough as the default bootstrap tool for new agents.

Accuracy impact:

- When it succeeds, it can return useful grouped context.
- When it fails, it returns no partial context, which violates the intended partial-result behavior.

Usefulness impact:

- High. This is the primary agent catch-up tool in the workflow.
- A new agent cannot depend on it if fast mode can fail because one LightRAG call times out.

Likely cause:

- `fast` mode still calls `lightrag.searchDocs` through manifest discovery.
- If that path goes through the HTTP sidecar and can still fail, fast mode is not fully isolated from backend semantic/search availability.

Conceptual solution:

- Make `fast` mode use a strictly metadata-backed path that cannot invoke expensive LightRAG semantic retrieval.
- Add a dedicated `list/search indexed chunks` adapter method for keyword scoring over repository chunks, or force `query_mode="naive"` to a local manifest-only engine path that never calls `rag.query`.
- Catch each manifest discovery failure independently and return exact ID context, memory facts, and warnings instead of failing the entire composer response.
- Add a regression test where `searchDocs` throws and `prepare_feature_context fast` still returns a shaped response with warning `lightrag_manifest_docs_failed` or `lightrag_manifest_code_failed`.

Success metric:

- `prepare_feature_context fast` returns a non-error response in 100% of tests when exact metadata storage is reachable, even when LightRAG semantic search is unavailable.

#### Broad semantic retrieval is intermittently unavailable

Problem:

- `search_docs` succeeded in an earlier check, then returned `BACKEND_UNAVAILABLE` in repeated verification attempts.
- `get_related_code` showed the same pattern.

Accuracy impact:

- Semantic tools can be useful when they return results, but availability instability makes the output operationally unreliable.

Usefulness impact:

- High for exploratory discovery, but not safe as a first-line tool.
- This justifies the usage-guide rule: exact and metadata-backed tools first, semantic retrieval only after narrowing.

Likely cause:

- Broad search still appears coupled to a backend path that can exceed MCP/client timeout or fail upstream.
- Timeout handling returns a top-level `BACKEND_UNAVAILABLE` instead of a partial candidate response.

Conceptual solution:

- Split `search_docs` into explicit modes: `manifest`/`keyword` and `semantic`.
- Default MCP `search_docs` should use bounded manifest search unless the caller explicitly requests semantic mode.
- Add per-mode timeout, retry, and fallback behavior.
- Record backend error details in tool-call logs and expose summarized reliability in `get_context_quality_metrics`.

Success metric:

- Manifest search p95 < 2s and availability >= 99%.
- Semantic search p95 < 15s and availability >= 95%, with structured warnings instead of opaque backend-unavailable failures where partial results exist.

#### Related-code relevance is weak for abstract feature queries

Problem:

- Querying `get_related_code` for `prepare feature context retrieval improvements` returned unrelated or only loosely related files such as ID registry and SPDD trace services in one successful sample.
- That makes the tool noisy for feature bootstrap unless the query is already highly specific.

Accuracy impact:

- Low to medium for broad feature text.
- Better expected accuracy when scoped by exact source path prefixes, domain terms, or explicit file names.

Usefulness impact:

- Medium. It can still produce candidates, but agents must verify with direct file reads before editing.

Likely cause:

- Keyword/semantic scoring over large file chunks favors shared terms like `context`, `stable ID`, `trace`, or `service`.
- Full-file code chunks are too coarse for precise feature mapping.

Conceptual solution:

- Chunk source files structurally by exported class/function/interface and important route/controller blocks.
- Add code-specific ranking features: symbol name match, path match, import graph distance, test/source pairing, and exact token boosts for service names.
- Allow `get_related_code` filters: `source_path_prefixes`, `symbols`, `file_globs`, `document_types`, and `limit`.
- Return score/explanation fields so agents understand why each file was selected.

Success metric:

- Top-5 precision for known feature queries >= 80%.
- At least one directly relevant implementation file appears in top 3 for benchmarked features.

### Medium Impact

#### Exact stable-ID retrieval is accurate but duplicate IDs reduce precision

Problem:

- `get_spec_context` for a known MCP requirement ID returned exact granular chunks, including a correct `markdown_table_row`.
- It also returned another chunk from a separate analysis document because the same stable ID appears in multiple current sources.

Accuracy impact:

- The chunks themselves are accurate.
- The answer set can be over-complete when stable IDs are duplicated across canonical and analysis artifacts.

Usefulness impact:

- High for exact retrieval, but agents need canonical-source preference.

Conceptual solution:

- Add source classification/ranking to exact ID tools: canonical requirement/spec docs first, SPDD analysis/prompt second, code/comments lower.
- Add an option such as `canonical_only=true` or `source_types=["srs","prd","adr"]`.
- Keep duplicate reporting, but make exact retrieval clearly label duplicate/canonical status.

Success metric:

- Exact stable-ID retrieval returns canonical chunks first in 100% of duplicate-ID cases.
- Duplicate supplemental chunks are labeled or hidden by default depending on caller mode.

#### `get_requirement_sources` is useful but too slow

Problem:

- `get_requirement_sources` for the same known MCP requirement ID succeeded, but one observed call took tens of seconds.

Accuracy impact:

- High when results arrive.

Usefulness impact:

- Medium. It is helpful for traceability, but too slow for every routine agent step.

Conceptual solution:

- Serve requirement-source lookup from indexed registry/chunk metadata only.
- Avoid semantic expansion by default.
- Add `limit`, `source_types`, and `canonical_only` parameters.
- Cache stable-ID to chunk mappings after ingestion.

Success metric:

- p95 latency < 2s for exact requirement-source lookup.

#### Memory tools return empty results without diagnostic meaning

Problem:

- `get_current_facts` and `get_history` returned empty arrays for some focused topics.
- An empty array may mean no fact exists, topic mismatch, graph retrieval miss, or stale/missing memory ingestion.

Accuracy impact:

- Empty results are not inaccurate, but they are ambiguous.

Usefulness impact:

- Medium. Agents cannot tell whether to trust the absence of facts.

Conceptual solution:

- Return metadata with empty results: searched topic, normalized topic, graph status, matched aliases, and result count.
- Add optional fuzzy topic suggestions for memory search.
- Add `confidence` or `diagnostics` fields for empty responses.

Success metric:

- Empty memory responses include diagnostic metadata in 100% of calls.

#### Ingestion warnings are too noisy for unrelated workflows

Problem:

- Ingestion and validation repeatedly report known duplicate stable IDs.
- The warnings are real, but they appear during unrelated document ingestion and can obscure new warnings.

Accuracy impact:

- High, because duplicates are valid warnings.

Usefulness impact:

- Medium. Repeated known warnings train agents to ignore warning blocks.

Conceptual solution:

- Separate `new_warnings` from `known_warnings`.
- Add warning IDs/fingerprints and first-seen timestamps.
- Let ingestion responses summarize known duplicates rather than printing all of them every time.

Success metric:

- Unrelated ingestion calls show zero repeated full duplicate lists unless `include_known_warnings=true`.

### Low Impact

#### Usage order now exists but is not yet enforced by tool descriptions

Problem:

- `docs/mcp-tool-usage-guide.md` defines the intended order, but MCP tool descriptions are still short and do not encode the workflow strongly.

Accuracy impact:

- Low. Tool behavior is unaffected.

Usefulness impact:

- Medium for agents that do not read the guide.

Conceptual solution:

- Expand MCP tool descriptions for `prepare_feature_context`, `search_docs`, `get_spec_context`, and `get_related_code`.
- Add examples in the tool descriptions showing preferred parameters.
- Optionally expose a `get_tool_usage_guide` tool or include the guide in `get_documentation_guidelines`.

Success metric:

- New agents choose exact/spec tools before semantic search in observed tool-call logs >= 90% of the time.

#### Some observability information is available but not directly tied to retrieval quality

Problem:

- Ingestion status and exact document retrieval are available.
- Evaluation still requires manual interpretation of availability, latency, and relevance.

Accuracy impact:

- Low. This does not affect retrieval output directly.

Usefulness impact:

- Medium for ongoing improvement work.

Conceptual solution:

- Add retrieval evaluation counters to context quality metrics: per-tool success rate, timeout rate, p50/p95 latency, average result size, empty-result rate, and top source paths.
- Track relevance feedback manually or through accepted file edits after retrieval.

Success metric:

- `get_context_quality_metrics` can answer "which MCP retrieval tool is currently noisy or failing?" without manual log inspection.

#### Documentation guide has no stable ID

Problem:

- The new MCP usage guide is retrievable by path but not by stable ID.

Accuracy impact:

- Low.

Usefulness impact:

- Low to medium. Stable IDs would make it easier to reference from SPDD artifacts or agent instructions.

Conceptual solution:

- If this guide becomes canonical policy, assign a durable requirement or decision ID after checking `list_stable_ids`.
- Alternatively link it from `docs/DOCUMENTATION-MAP.md` so discovery does not depend on semantic search.

Success metric:

- Guide is reachable through canonical navigation and exact document lookup.

## Tool Accuracy Assessment

### High Accuracy

- `get_documentation_guidelines`: Accurate for stable ID rules and canonical documentation policy.
- `get_document`: Accurate when the caller knows a path or chunk ID.
- `get_spec_context`: Accurate for stable-ID anchored chunks; granular Markdown table rows are working.
- `get_ingestion_status`: Accurate operational history, though verbose.

### Medium Accuracy

- `get_requirement_sources`: Accurate but slow and potentially over-complete.
- `get_current_facts` / `get_history`: Accurate when populated, but empty responses need diagnostics.
- `validate_ids`: Accurate duplicate detection, but noisy during unrelated tasks.
- `prepare_feature_context`: Conceptually improved, but current availability/relevance is not stable enough to classify as high accuracy.

### Low To Medium Accuracy

- `search_docs`: Useful when available, but intermittent and should not be treated as authoritative.
- `get_related_code`: Candidate discovery only; relevance can be weak for abstract feature names.

## Recommended Improvements

### Phase 1: Reliability First

1. Make `prepare_feature_context fast` independent from semantic/backend-unavailable failure.
2. Add manifest-only default mode to `search_docs` and `get_related_code`.
3. Ensure all staged retrieval failures become warnings with partial responses.
4. Add timeout/fallback tests around `prepare_feature_context`, `search_docs`, and `get_related_code`.

### Phase 2: Relevance And Precision

1. Add canonical-source ranking to stable-ID retrieval.
2. Add structural code chunking by symbol or route/service block.
3. Add code retrieval filters and result explanations.
4. Add benchmark queries for known features and track top-k precision.

### Phase 3: Observability And Agent Guidance

1. Add per-tool success rate, timeout rate, p95 latency, result count, and empty-result metrics.
2. Summarize known ingestion warnings separately from new warnings.
3. Put the MCP usage guide into canonical documentation navigation.
4. Expand MCP tool descriptions with usage order and mode guidance.

## Proposed Evaluation Metrics

| Metric | Definition | Target |
|---|---|---:|
| Availability | Percentage of calls returning `ok=true`. | Exact tools >= 99%, discovery tools >= 95%. |
| p95 latency | 95th percentile wall-clock time per tool. | Exact tools < 1s, manifest discovery < 3s, semantic < 15s. |
| Partial response rate | Percentage of upstream failures that still return usable partial context with warnings. | >= 95% for composer tools. |
| Top-k precision | Percentage of top-k retrieval results judged directly relevant. | `get_related_code` top-5 >= 80%. |
| Exact-anchor precision | Percentage of stable-ID/path lookups where returned chunks exactly contain the requested anchor. | >= 99%. |
| Canonical-first rate | Percentage of duplicate stable-ID lookups where canonical docs appear before analysis/prompt/code artifacts. | 100%. |
| Warning novelty ratio | Percentage of warnings that are new/actionable instead of repeated known warnings. | >= 80%. |
| Empty-result diagnostics coverage | Empty memory/search responses that include reason/status metadata. | 100%. |

## Operating Guidance Until Fixes Land

1. Use `get_documentation_guidelines`, `get_document`, and `get_spec_context` as the reliable baseline.
2. Use `prepare_feature_context fast` only as a convenience composer; if it fails, fall back to exact ID/path tools and direct file inspection.
3. Treat `search_docs` and `get_related_code` as candidate generators, not authority.
4. Always follow returned source paths with direct code reads before editing.
5. Use `get_ingestion_status` before concluding that a retrieval miss means content does not exist.
6. Expect duplicate stable-ID warnings until the existing registry issues are cleaned up or warning suppression is implemented.
