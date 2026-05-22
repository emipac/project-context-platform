## Project discovery and research rules

When the developer asks project-related questions, asks you to investigate behavior, or asks for implementation context, use PCP MCP tools first before broad manual code exploration. PCP is the project memory and retrieval layer; it should be the fastest path to requirements, decisions, architecture context, indexed documents, historical work, and traceability.

Use tools in this order when the question is about this project:

1. `get_documentation_guidelines`
   - Read project conventions, stable ID rules, canonical documentation locations, and memory guidance.
   - Use this early when the task involves writing or changing documentation, requirements, ADRs, SPDD prompts, or stable IDs.

2. `prepare_feature_context`
   - Use for feature, implementation, or architecture questions where the developer names a feature, capability, task, or requirement area.
   - Defaults to **`retrieval_mode: fast`** (exact IDs + manifest/keyword + memory only). Use `semantic` or `deep` only when you need scoped LightRAG after narrowing; **`deep` runs docs and code semantic retrieval in parallel** so latency stays within one semantic timeout budget.
   - Prefer this before ad hoc searches because it composes docs, memory, related sources, and traceability.

3. `get_spec_context` / `get_requirement_sources`
   - Use when the developer gives a stable ID, ADR, requirement, task, acceptance criterion, or source path.
   - Prefer exact stable-ID retrieval over semantic search.

4. `get_current_facts` and `get_history`
   - Use for questions about current decisions, deprecated facts, prior implementation choices, requirement changes, or why the system behaves a certain way.
   - Query focused topics such as `ID Registry`, `SPDD trace`, `LightRAG`, `Graphiti`, `MCP tools`, `ingestion`, or the named feature.

5. `search_docs`
   - Use for broad discovery only after exact context and memory tools do not fully answer the question.
   - Keep queries specific and prefer returned stable IDs and source paths as follow-up anchors.
   - Broad `search_docs` is for canonical context discovery; results apply source-diversity ranking (at most two chunks per `source_path` before the final limit).
   - For implementation lookup, prefer `get_related_code` or scoped `search_docs` with `document_types` / `source_path_prefixes`, then read source files from disk.
   - `get_document` on code paths returns compact summary cards (`path`, `basename`, `path_tokens`, `primary_symbol`, symbols, hash)—not full source; read the file on disk to edit implementation.

6. `lookup_spdd_trace` / `list_spdd_trace`
   - Use when the question involves SPDD prompts, REASONS Canvas work, implementation history, changed files, traceability, or "which prompt worked on this?"
   - Query by `artifact_path`, `stable_id`, `source_path`, `chunk_id`, or `feature_ref` when available.

7. `validate_ids`
   - Use before adding or changing stable IDs.
   - Call `list_stable_ids` it before inventing new IDs so occupied IDs can be checked by category/domain.

After the PCP tools identify relevant files, inspect the codebase directly with targeted searches and file reads. Do not exhaustively read the repository when PCP can narrow the scope.

For external packages, frameworks, APIs, and library behavior that are not owned by this repository, use authoritative documentation tools before guessing. Prefer Context7 or an equivalent documentation tool when available, then official project documentation. Use general web search only when project docs or official docs are unavailable or insufficient.

When combining PCP context with external package research, clearly separate:
- project-specific facts from PCP and local code,
- external-library facts from documentation,
- your own inferences.

## SPDD Implementation rules

When you are implementing an SPDD REASONS-Canvas prompt for the project.

Input:
- Project ID: `pcp`
- SPDD prompt artifact: `<spdd/prompt/...md>`

Before editing code, use PCP MCP tools in this order:

1. `sync_spdd_artifacts`
   - Ensure the SPDD prompt artifact is registered.

2. `list_spdd_trace`
   - Query by `artifact_path` for the prompt.
   - Check whether this prompt already has prior runs or trace links.

3. `get_documentation_guidelines`
   - Read project stable ID rules, domain conventions, and memory guidance.

4. `prepare_feature_context`
   - Use the feature name from the REASONS prompt.
   - Include explicit requirement IDs or task IDs from the prompt when present.
   - Default composer mode is **`fast`**. Use **`semantic` or `deep`** only when cheap context is not enough; **`deep`** issues two semantic calls concurrently (docs + code) within one timeout window.

5. `get_spec_context` / `get_requirement_sources`
   - For each explicit requirement, ADR, task, or acceptance criterion referenced by the prompt, retrieve exact context.

6. `get_current_facts` and `get_history`
   - Query relevant topics from the prompt, especially architecture decisions, sidecar behavior, ingestion, traceability, MCP tools, and ID Registry rules.

7. `search_docs`
   - Use only for gaps after exact ID/context lookup.
   - Prefer exact stable-ID context over broad semantic search.

8. `lookup_spdd_trace`
   - Check whether related stable IDs, files, chunks, or feature refs already have SPDD work history.

9. `validate_ids`
   - Check duplicate/stale ID health before creating or modifying documents with stable IDs.
   - When `list_stable_ids` exists, call it before assigning new stable IDs.

Then produce a short implementation plan. Do not edit files until the plan is coherent with the REASONS Canvas, retrieved specs, current facts, and trace history.

During implementation:
- Keep changes narrowly scoped to the REASONS prompt.
- Preserve existing architecture and behavior unless the prompt explicitly requires change.
- Reuse existing services, repositories, DTOs, adapters, routes, and UI patterns.
- Add or update tests proportional to the risk.
- Do not invent new stable IDs without checking existing IDs first.
- Track the files changed, stable IDs touched, chunks or sources consulted, and important decisions made.

After implementation, use PCP MCP tools in this order:

1. Run the relevant local tests and checks.

2. `validate_against_specs`
   - Validate the implementation plan or final diff against the related requirement IDs.

3. `ingest_changed_files`
   - Index changed files so LightRAG and the local metadata registry see the new state.

4. `validate_ids`
   - Confirm no duplicate or invalid stable IDs were introduced.

5. `record_spdd_run`
   - Record the completed SPDD work run.
   - Include:
     - `artifact_path`
     - concise `summary`
     - `status: "completed"`
     - `relation: "implemented"` or `"changed"`
     - related `stable_ids`
     - changed `source_paths`
     - known `chunk_ids` when available
     - `feature_refs`
     - relevant `tool_call_ids` if available
     - `mirror_to_memory: true`

6. `list_spdd_trace` or `lookup_spdd_trace`
   - Verify that the prompt/run is now linked to the expected IDs, files, chunks, or feature refs.

Only use `remember_decision`, `remember_requirement_change`, or `remember_review` separately when the work creates a durable decision, changes a requirement, or records a review finding. Do not duplicate a normal implementation summary if `record_spdd_run` already mirrored it to memory.
