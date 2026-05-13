import type { createAppServices } from "@pcp/infra";
import { mcpToolWrapper } from "./tool-wrapper.js";
import { previewChunks, withClampedLimit } from "./preview.js";
import { getDocumentationGuidelines } from "./documentation-guidelines.js";

type Services = ReturnType<typeof createAppServices>;
type Handler = (input: Record<string, unknown>) => Promise<unknown>;

export function registerAllTools(services: Services): Record<string, Handler> {
  const wrap = (name: string, handler: Handler) => mcpToolWrapper(name, services.toolCalls, handler);
  return {
    search_docs: wrap("search_docs", async (input) => previewChunks(await services.retrieval.searchDocs(input.project_id as string | undefined, String(input.query), withClampedLimit(input)))),
    get_document: wrap("get_document", (input) => services.retrieval.getDocument(input.project_id as string | undefined, {
      chunk_id: input.chunk_id as string | undefined,
      source_path: input.source_path as string | undefined
    })),
    get_spec_context: wrap("get_spec_context", (input) => services.retrieval.getSpecContext(input.project_id as string | undefined, String(input.spec_id), Boolean(input.include_neighbors))),
    get_related_code: wrap("get_related_code", async (input) => previewChunks(await services.retrieval.getRelatedCode(input.project_id as string | undefined, String(input.feature_name ?? input.requirement_id ?? ""), withClampedLimit(input)))),
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
      optional_task_id: input.task_id as string | undefined
    })),
    prepare_review_context: wrap("prepare_review_context", (input) => services.composer.prepareReviewContext(input.project_id as string | undefined, {
      changed_files: input.changed_files as string[] | undefined,
      diff: input.diff as string | undefined
    })),
    validate_against_specs: wrap("validate_against_specs", (input) => services.composer.validateAgainstSpecs(input.project_id as string | undefined, {
      plan: input.plan as string | undefined,
      diff: input.diff as string | undefined,
      requirement_ids: input.requirement_ids as string[] | undefined
    })),
    remember_implementation_summary: wrap("remember_implementation_summary", (input) => services.memory.commitLowRisk(String(input.project_id), { type: "implementation_summary", ...input })),
    ingest_changed_files: wrap("ingest_changed_files", (input) => services.ingestion.ingestChanged(String(input.project_id), input.paths as string[] | undefined)),
    ingest_document: wrap("ingest_document", (input) => services.ingestion.ingestDocument(String(input.project_id), String(input.path))),
    get_ingestion_status: wrap("get_ingestion_status", (input) => services.ingestion.getIngestionStatus(String(input.project_id), input.job_id as string | undefined)),
    validate_ids: wrap("validate_ids", (input) => services.ids.validateIds(String(input.project_id)))
  };
}
