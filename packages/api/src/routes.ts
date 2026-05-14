import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { createAppServices } from "@pcp/infra";
import { loadProjectConfig, PlatformError, type SpddTraceFilter } from "@pcp/core";

type Services = ReturnType<typeof createAppServices>;

export async function registerRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.get("/health", async () => {
    const [lightragHealth, graphitiHealth] = await Promise.all([
      sidecarHealth(() => services.lightrag.getHealth()),
      sidecarHealth(() => services.graphiti.getHealth())
    ]);
    const lightragOk = lightragHealth.reachable && lightragHealth.status === "ok";
    const graphitiOk = graphitiHealth.reachable && graphitiHealth.status === "ok";
    return {
      status: lightragOk && graphitiOk ? "ok" : "degraded",
      adapter_mode: services.adapterMode,
      sqlite: true,
      lightrag: lightragOk,
      graphiti: graphitiOk,
      sidecars: {
        lightrag: lightragHealth,
        graphiti: graphitiHealth
      }
    };
  });

  app.get("/api/projects", async () => services.workspaces.listWorkspaces());
  app.post("/api/projects", async (request) => services.workspaces.registerWorkspace(z.object({
    project_id: z.string().optional(),
    name: z.string().optional(),
    rootPath: z.string()
  }).parse(request.body)));
  app.get("/api/projects/:project_id", async (request) => services.workspaces.getWorkspace(params(request).project_id));
  app.patch("/api/projects/:project_id", async (request) => services.workspaces.patchWorkspace(params(request).project_id, z.record(z.unknown()).parse(request.body)));
  app.get("/api/projects/:project_id/settings", async (request) => {
    const workspace = await services.workspaces.getWorkspace(params(request).project_id);
    return { project_id: workspace.project_id, config: loadProjectConfig(workspace.rootPath) };
  });
  app.patch("/api/projects/:project_id/settings", async (request) => ({ project_id: params(request).project_id, updated: z.record(z.unknown()).parse(request.body) }));

  app.delete("/api/projects/:project_id", async (request) => {
    const project_id = params(request).project_id;
    const q = query(request);
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const bodyParsed = z.object({
      confirmed: z.boolean(),
      delete_project_context_dir: z.boolean().optional()
    }).safeParse(body);
    let confirmed = bodyParsed.success ? bodyParsed.data.confirmed : false;
    let delete_project_context_dir = bodyParsed.success ? Boolean(bodyParsed.data.delete_project_context_dir) : false;
    if (!confirmed && q.confirmed === "true") confirmed = true;
    if (!delete_project_context_dir && q.delete_project_context_dir === "true") delete_project_context_dir = true;
    if (!confirmed) throw new PlatformError("CONFIRMATION_REQUIRED", undefined, { project_id });
    return services.projectDeletion.deleteProject(project_id, { confirmed: true, deleteProjectContextDir: delete_project_context_dir, requested_by: "rest" });
  });

  app.post("/api/projects/:project_id/ingest", async (request) => services.ingestion.ingestFull(params(request).project_id, z.object({ confirmed: z.boolean().optional() }).parse(request.body ?? {})));
  app.post("/api/projects/:project_id/ingest/changed", async (request) => services.ingestion.ingestChanged(params(request).project_id, z.object({ paths: z.array(z.string()).optional() }).parse(request.body ?? {}).paths));
  app.get("/api/projects/:project_id/ingestion/status", async (request) => services.ingestion.getIngestionStatus(params(request).project_id, query(request).job_id));
  app.get("/api/projects/:project_id/documents", async (request) => services.retrieval.searchDocs(params(request).project_id, "", { limit: Number(query(request).limit ?? 200) }));
  app.post("/api/projects/:project_id/search", async (request) => {
    const body = z.object({ query: z.string(), limit: z.number().optional(), document_types: z.array(z.string()).optional() }).parse(request.body);
    return services.retrieval.searchDocs(params(request).project_id, body.query, body);
  });
  app.get("/api/projects/:project_id/specs/:stable_id", async (request) => services.retrieval.getSpecContext(params(request).project_id, params(request).stable_id, query(request).include_neighbors === "true"));
  app.get("/api/projects/:project_id/ids", async (request) => {
    const entries = await services.repository.listRegistryEntries(params(request).project_id);
    return query(request).include_stale === "true" ? entries : entries.filter((entry) => entry.status !== "stale");
  });
  app.get("/api/projects/:project_id/ids/:stable_id", async (request) => (await services.repository.listRegistryEntries(params(request).project_id)).filter((entry) => {
    const stableId = params(request).stable_id;
    return entry.stable_id === stableId || entry.aliases?.includes(stableId);
  }));
  app.get("/api/projects/:project_id/requirements/:requirement_id/sources", async (request) => services.retrieval.getRequirementSources(params(request).project_id, params(request).requirement_id));
  app.post("/api/projects/:project_id/context/feature", async (request) => services.composer.prepareFeatureContext(params(request).project_id, z.object({
    feature_name: z.string(),
    optional_requirement_ids: z.array(z.string()).optional(),
    optional_task_id: z.string().optional()
  }).parse(request.body)));
  app.post("/api/projects/:project_id/context/review", async (request) => services.composer.prepareReviewContext(params(request).project_id, z.object({
    changed_files: z.array(z.string()).optional(),
    diff: z.string().optional()
  }).parse(request.body ?? {})));
  app.post("/api/projects/:project_id/validate", async (request) => services.composer.validateAgainstSpecs(params(request).project_id, z.object({
    plan: z.string().optional(),
    diff: z.string().optional(),
    requirement_ids: z.array(z.string()).optional()
  }).parse(request.body ?? {})));
  app.get("/api/projects/:project_id/memory", async (request) => services.graphiti.getHistory(params(request).project_id, "", true));
  app.get("/api/projects/:project_id/memory/facts", async (request) => services.memory.getCurrentFacts(params(request).project_id, String(query(request).topic ?? "")));
  app.get("/api/projects/:project_id/memory/history", async (request) => services.memory.getHistory(params(request).project_id, String(query(request).topic ?? ""), query(request).include_deprecated === "true"));
  app.post("/api/projects/:project_id/memory/decisions", async (request) => services.memory.commitLowRisk(params(request).project_id, { type: "decision", ...z.record(z.unknown()).parse(request.body) }));
  app.post("/api/projects/:project_id/memory/reviews", async (request) => services.memory.commitHighRisk(params(request).project_id, { type: "review_finding", ...z.record(z.unknown()).parse(request.body) }, z.object({ decision: z.literal("approved") }).passthrough().parse(request.body)));
  app.post("/api/projects/:project_id/memory/requirement-changes", async (request) => services.memory.commitHighRisk(params(request).project_id, { type: "requirement_change", ...z.record(z.unknown()).parse(request.body) }, z.object({ decision: z.literal("approved") }).passthrough().parse(request.body)));
  app.post("/api/projects/:project_id/memory/implementation-summaries", async (request) => services.memory.commitLowRisk(params(request).project_id, { type: "implementation_summary", ...z.record(z.unknown()).parse(request.body) }));
  app.get("/api/projects/:project_id/approvals", async (request) => services.graphiti.getHistory(params(request).project_id, "approval", true));
  app.post("/api/projects/:project_id/approvals", async (request) => services.memory.rememberApproval(params(request).project_id, z.record(z.unknown()).parse(request.body)));
  app.post("/api/projects/:project_id/memory/review-preview", async (request) => services.memory.previewMemoryWrite(params(request).project_id, z.record(z.unknown()).parse(request.body)));
  app.get("/api/projects/:project_id/tool-call-logs", async (request) => services.toolCalls.list(params(request).project_id));

  app.post("/api/projects/:project_id/spdd-trace/artifacts/sync", async (request) =>
    services.spddTrace.syncArtifacts(params(request).project_id));

  app.get("/api/projects/:project_id/spdd-trace/artifacts", async (request) => {
    const trace = await services.spddTrace.listTrace(params(request).project_id, spddTraceFilterFromQuery(query(request)));
    return { artifacts: trace.artifacts, warnings: trace.warnings };
  });

  app.post("/api/projects/:project_id/spdd-trace/runs", async (request) =>
    services.spddTrace.recordRun(params(request).project_id, recordSpddRunBody.parse(request.body ?? {})));

  app.get("/api/projects/:project_id/spdd-trace/runs", async (request) =>
    services.spddTrace.listTrace(params(request).project_id, spddTraceFilterFromQuery(query(request))));

  app.get("/api/projects/:project_id/spdd-trace/lookup", async (request) =>
    services.spddTrace.lookupByTarget(params(request).project_id, spddTraceFilterFromQuery(query(request))));
}

const spddArtifactTypeSchema = z.enum(["prompt", "analysis", "plan", "review", "unknown"]);
const spddTargetTypeSchema = z.enum(["stable_id", "source_path", "chunk", "feature", "tool_call", "memory_event"]);

const recordSpddRunBody = z.object({
  artifact_id: z.string().optional(),
  artifact_path: z.string().optional(),
  title: z.string().optional(),
  summary: z.string(),
  status: z.enum(["planned", "in_progress", "completed", "reverted", "superseded"]).optional(),
  actor: z.string().optional(),
  channel: z.string().optional(),
  stable_ids: z.array(z.string()).optional(),
  source_paths: z.array(z.string()).optional(),
  chunk_ids: z.array(z.string()).optional(),
  feature_refs: z.array(z.string()).optional(),
  tool_call_ids: z.array(z.string()).optional(),
  memory_event_ids: z.array(z.string()).optional(),
  relation: z.enum(["retrieved", "referenced", "implemented", "changed", "reviewed", "validated", "summarized"]).optional(),
  mirror_to_memory: z.boolean().optional()
});

function parseSpddLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(200, Math.max(1, n));
}

function spddTraceFilterFromQuery(q: Record<string, string | undefined>): SpddTraceFilter {
  const artifact_type = q.artifact_type ? spddArtifactTypeSchema.parse(q.artifact_type) : undefined;
  const target_type = q.target_type ? spddTargetTypeSchema.parse(q.target_type) : undefined;
  return {
    run_id: q.run_id,
    artifact_id: q.artifact_id,
    artifact_path: q.artifact_path,
    stable_id: q.stable_id,
    source_path: q.source_path,
    chunk_id: q.chunk_id,
    feature_ref: q.feature_ref,
    artifact_type,
    target_type,
    target_id: q.target_id,
    include_stale: q.include_stale === "true",
    limit: parseSpddLimit(q.limit)
  };
}

function params(request: { params: unknown }): Record<string, string> {
  return request.params as Record<string, string>;
}

function query(request: { query: unknown }): Record<string, string | undefined> {
  return request.query as Record<string, string | undefined>;
}

async function sidecarHealth(load: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown> & { reachable: boolean }> {
  try {
    const health = await load();
    return { ...health, reachable: true };
  } catch {
    return { reachable: false, status: "unreachable" };
  }
}
