import type { createAppServices } from "@pcp/infra";
import { createRuntimeIdentity } from "@pcp/infra";
import {
  PlatformError,
  clampContextGraphEdgeLimit,
  CONTEXT_GRAPH_NODE_TYPES,
  normalizeContextGraphNodeType,
  normalizeContextGraphRootType,
  normalizeContextGraphQueryMode,
  normalizeContextGraphOrdering,
  splitCommaQuery,
  type ContextObservabilityFilter,
  type RecordSpddRunDTO,
  type SpddTraceFilter,
  type StableIdLookupFilter
} from "@pcp/core";
import { mcpToolWrapper } from "./tool-wrapper.js";
import { previewChunks, retrievalBudgetFromToolInput } from "./preview.js";
import { getDocumentationGuidelines } from "./documentation-guidelines.js";

type Services = ReturnType<typeof createAppServices>;
type Handler = (input: Record<string, unknown>) => Promise<unknown>;

export function registerAllTools(services: Services): Record<string, Handler> {
  const wrap = (name: string, handler: Handler) => mcpToolWrapper(name, services.toolCalls, handler);
  return {
    search_docs: wrap("search_docs", async (input) =>
      previewChunks(await services.retrieval.searchDocs(input.project_id as string | undefined, String(input.query), retrievalBudgetFromToolInput(input)))
    ),
    get_document: wrap("get_document", (input) => services.retrieval.getDocument(input.project_id as string | undefined, {
      chunk_id: input.chunk_id as string | undefined,
      source_path: input.source_path as string | undefined
    })),
    get_spec_context: wrap("get_spec_context", (input) => services.retrieval.getSpecContext(input.project_id as string | undefined, String(input.spec_id), Boolean(input.include_neighbors))),
    get_related_code: wrap("get_related_code", async (input) =>
      previewChunks(
        await services.retrieval.getRelatedCode(
          input.project_id as string | undefined,
          String(input.feature_name ?? input.requirement_id ?? ""),
          retrievalBudgetFromToolInput(input)
        )
      )
    ),
    get_requirement_sources: wrap("get_requirement_sources", async (input) => previewChunks(await services.retrieval.getRequirementSources(input.project_id as string | undefined, String(input.requirement_id)))),
    get_documentation_guidelines: wrap("get_documentation_guidelines", (input) => getDocumentationGuidelines(services, input)),
    remember_decision: wrap("remember_decision", (input) => services.memory.commitLowRisk(String(input.project_id), { type: "decision", ...input })),
    remember_review: wrap("remember_review", (input) => services.memory.commitHighRisk(String(input.project_id), { type: "review_finding", ...input }, { decision: "approved", channel: "cursor" })),
    remember_requirement_change: wrap("remember_requirement_change", (input) => services.memory.commitHighRisk(String(input.project_id), { type: "requirement_change", ...input }, { decision: "approved", channel: "cursor" })),
    remember_approval: wrap("remember_approval", (input) => services.memory.rememberApproval(String(input.project_id), input)),
    get_current_facts: wrap("get_current_facts", (input) => services.memory.getCurrentFacts(input.project_id as string | undefined, String(input.topic), input.related_requirement_id as string | undefined)),
    get_history: wrap("get_history", (input) => services.memory.getHistory(input.project_id as string | undefined, String(input.topic), Boolean(input.include_deprecated))),
    prepare_feature_context: wrap("prepare_feature_context", (input) => services.composer.prepareFeatureContext(input.project_id as string | undefined, {
      feature_name: String(input.feature_name),
      optional_requirement_ids: input.requirement_ids as string[] | undefined,
      optional_task_id: input.task_id as string | undefined,
      retrieval_mode: input.retrieval_mode as "fast" | "semantic" | "deep" | undefined,
      document_types: input.document_types as string[] | undefined,
      source_path_prefixes: input.source_path_prefixes as string[] | undefined,
      chunk_kinds: input.chunk_kinds as string[] | undefined
    })),
    prepare_review_context: wrap("prepare_review_context", (input) => services.composer.prepareReviewContext(input.project_id as string | undefined, {
      changed_files: input.changed_files as string[] | undefined,
      diff: input.diff as string | undefined
    })),
    validate_against_specs: wrap("validate_against_specs", (input) => services.composer.validateAgainstSpecs(input.project_id as string | undefined, {
      plan: input.plan as string | undefined,
      diff: input.diff as string | undefined,
      requirement_ids: input.requirement_ids as string[] | undefined,
      artifact_path: input.artifact_path as string | undefined,
      changed_files: input.changed_files as string[] | undefined,
      source_paths: input.source_paths as string[] | undefined,
      mode: input.mode as "fast" | "strict" | undefined
    })),
    get_context_freshness: wrap("get_context_freshness", (input) =>
      services.contextObservability.getFreshnessReport(input.project_id as string | undefined, observabilityFilter(input, false))
    ),
    get_context_quality_metrics: wrap("get_context_quality_metrics", (input) =>
      services.contextObservability.getQualityMetrics(input.project_id as string | undefined, observabilityFilter(input, false))
    ),
    get_context_graph: wrap("get_context_graph", (input) =>
      services.contextObservability.getContextGraph(input.project_id as string | undefined, observabilityFilter(input, true))
    ),
    remember_implementation_summary: wrap("remember_implementation_summary", (input) => services.memory.commitLowRisk(String(input.project_id), { type: "implementation_summary", ...input })),
    ingest_changed_files: wrap("ingest_changed_files", (input) => services.ingestion.ingestChanged(String(input.project_id), input.paths as string[] | undefined)),
    ingest_document: wrap("ingest_document", (input) => services.ingestion.ingestDocument(String(input.project_id), String(input.path))),
    get_ingestion_status: wrap("get_ingestion_status", (input) => services.ingestion.getIngestionStatus(String(input.project_id), input.job_id as string | undefined)),
    validate_ids: wrap("validate_ids", (input) => services.ids.validateIds(String(input.project_id))),
    list_stable_ids: wrap("list_stable_ids", async (input) => {
      const requested = input.project_id as string | undefined;
      const workspace = await services.workspaces.resolveProjectOrActive(
        typeof requested === "string" && requested.trim() !== "" ? requested.trim() : undefined
      );
      return services.ids.listStableIds(workspace.project_id, stableIdLookupFilters(input));
    }),
    sync_spdd_artifacts: wrap("sync_spdd_artifacts", (input) => services.spddTrace.syncArtifacts(input.project_id as string | undefined)),
    record_spdd_run: wrap("record_spdd_run", (input) => services.spddTrace.recordRun(input.project_id as string | undefined, toRecordSpddRun(input))),
    list_spdd_trace: wrap("list_spdd_trace", (input) => services.spddTrace.listTrace(input.project_id as string | undefined, spddTraceFilters(input))),
    lookup_spdd_trace: wrap("lookup_spdd_trace", (input) => services.spddTrace.lookupByTarget(input.project_id as string | undefined, spddTraceFilters(input))),
    platform_runtime: wrap("platform_runtime", async () => createRuntimeIdentity(services.adapterMode))
  };
}

function observabilityFilter(input: Record<string, unknown>, graph: boolean): ContextObservabilityFilter {
  const filter: ContextObservabilityFilter = { include_stale: Boolean(input.include_stale) };
  if (graph && input.limit !== undefined && input.limit !== null) {
    filter.limit = clampContextGraphEdgeLimit(Number(input.limit));
  }
  if (graph && Array.isArray(input.types)) {
    const types = input.types.map((item) => normalizeContextGraphNodeType(String(item)));
    const allowed = new Set<string>(CONTEXT_GRAPH_NODE_TYPES as unknown as string[]);
    const invalid = types.filter((item) => !allowed.has(item));
    if (invalid.length) {
      throw new PlatformError("VALIDATION_ERROR", "Invalid graph node types.", {
        details: { invalid, allowed: [...allowed], aliases: { artifact: "spdd_artifact", run: "spdd_run", feature: "feature_ref" } }
      });
    }
    filter.types = types;
  }
  if (graph) {
    const modeRaw = input.mode;
    if (modeRaw !== undefined && modeRaw !== null && String(modeRaw).trim() !== "") {
      filter.mode = normalizeContextGraphQueryMode(String(modeRaw));
    }
    const rt = input.root_type;
    if (typeof rt === "string" && rt.trim()) filter.root_type = normalizeContextGraphRootType(rt);
    const rid = input.root_id;
    if (typeof rid === "string" && rid.trim()) filter.root_id = rid.trim();

    const depthRaw = input.depth;
    if (depthRaw !== undefined && depthRaw !== null && String(depthRaw).trim() !== "") {
      const d = Number(depthRaw);
      if (!Number.isFinite(d)) {
        throw new PlatformError("VALIDATION_ERROR", "Invalid graph depth parameter.", { details: { depth: depthRaw } });
      }
      filter.depth = d;
    }

    filter.edge_types = stringOrCommaList(input.edge_types);
    filter.status = stringOrCommaList(input.status);
    filter.relation = stringOrCommaList(input.relation);

    const ord = input.ordering;
    if (ord !== undefined && String(ord).trim() !== "") {
      filter.ordering = normalizeContextGraphOrdering(String(ord));
    }

    if (typeof input.run_id === "string" && input.run_id.trim()) filter.run_id = input.run_id.trim();
    if (typeof input.artifact_path === "string" && input.artifact_path.trim()) filter.artifact_path = input.artifact_path.trim();
    if (typeof input.source_path === "string" && input.source_path.trim()) filter.source_path = input.source_path.trim();
    if (typeof input.stable_id === "string" && input.stable_id.trim()) filter.stable_id = input.stable_id.trim();
    if (typeof input.feature_ref === "string" && input.feature_ref.trim()) filter.feature_ref = input.feature_ref.trim();
  }
  const cfd = input.changed_file_detection;
  if (cfd === "off" || cfd === "git" || cfd === "auto") filter.changed_file_detection = cfd;
  return filter;
}

function stringOrCommaList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const arr = value.map((v) => String(v).trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  }
  if (typeof value === "string") return splitCommaQuery(value);
  return undefined;
}

function stableIdLookupFilters(input: Record<string, unknown>): StableIdLookupFilter {
  const limRaw = input.limit;
  const limit =
    typeof limRaw === "number" && Number.isFinite(limRaw) ? Math.min(200, Math.max(1, Math.floor(limRaw))) : undefined;
  const normStr = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  return {
    category: input.category as StableIdLookupFilter["category"],
    domain: normStr(input.domain),
    source_path: normStr(input.source_path),
    status: input.status as StableIdLookupFilter["status"],
    include_stale: Boolean(input.include_stale),
    include_aliases: Boolean(input.include_aliases),
    limit
  };
}

function spddTraceFilters(input: Record<string, unknown>): SpddTraceFilter {
  const limRaw = input.limit;
  const limit = typeof limRaw === "number" && Number.isFinite(limRaw) ? Math.min(200, Math.max(1, limRaw)) : undefined;
  return {
    run_id: input.run_id as string | undefined,
    artifact_id: input.artifact_id as string | undefined,
    artifact_path: input.artifact_path as string | undefined,
    stable_id: input.stable_id as string | undefined,
    source_path: input.source_path as string | undefined,
    chunk_id: input.chunk_id as string | undefined,
    feature_ref: input.feature_ref as string | undefined,
    artifact_type: input.artifact_type as SpddTraceFilter["artifact_type"],
    target_type: input.target_type as SpddTraceFilter["target_type"],
    target_id: input.target_id as string | undefined,
    include_stale: Boolean(input.include_stale),
    limit
  };
}

function toRecordSpddRun(input: Record<string, unknown>): RecordSpddRunDTO {
  return {
    artifact_id: input.artifact_id as string | undefined,
    artifact_path: input.artifact_path as string | undefined,
    title: input.title as string | undefined,
    summary: String(input.summary ?? ""),
    status: input.status as RecordSpddRunDTO["status"],
    actor: input.actor as string | undefined,
    channel: input.channel as string | undefined,
    stable_ids: input.stable_ids as string[] | undefined,
    source_paths: input.source_paths as string[] | undefined,
    chunk_ids: input.chunk_ids as string[] | undefined,
    feature_refs: input.feature_refs as string[] | undefined,
    tool_call_ids: input.tool_call_ids as string[] | undefined,
    memory_event_ids: input.memory_event_ids as string[] | undefined,
    relation: input.relation as RecordSpddRunDTO["relation"],
    mirror_to_memory: Boolean(input.mirror_to_memory)
  };
}
