import type {
  CanonicalDocumentChunk,
  ChangedFileDetectionMode,
  ContextFreshnessReport,
  ContextFreshnessStatus,
  ContextGraph,
  ContextGraphEdge,
  ContextGraphNode,
  ContextObservabilityFilter,
  ContextQualityMetrics,
  FreshnessSignal,
  FreshnessSummary,
  IdRegistryEntry,
  IngestionJob,
  MetricWarning,
  SpddArtifact,
  SpddTraceFilter,
  SpddTraceLink,
  SpddWorkRun
} from "../domain/types.js";
import type { MetadataRepository, ToolCallLogger } from "../ports/adapters.js";
import { PlatformError } from "../errors/platform-error.js";
import {
  assertGraphStaleStatusConsistency,
  normalizeContextGraphOrdering,
  resolveAnchoredDepth,
  validateContextGraphEdgeTypes,
  validateContextGraphLinkStatuses,
  validateContextGraphRelations,
  type ContextGraphOrdering,
  type ContextGraphRootType
} from "../context/context-graph-params.js";
import { loadProjectConfig } from "../config/project-config.js";
import { ProjectWorkspaceService } from "./project-workspace-service.js";
import { gitWorkingTreePaths } from "../utils/git-status-paths.js";
import { isProjectIndexablePath } from "../utils/indexable-path.js";

const GRAPH_EDGE_LIMIT_DEFAULT = 200;
const GRAPH_EDGE_LIMIT_MIN = 10;
const GRAPH_EDGE_LIMIT_MAX = 800;

/** Declared graph node `type` values (plus dynamic `trace_target` for unexpected enums). */
export const CONTEXT_GRAPH_NODE_TYPES = [
  "project",
  "source_path",
  "chunk",
  "stable_id",
  "spdd_artifact",
  "spdd_run",
  "tool_call",
  "memory_event",
  "feature_ref",
  "trace_target"
] as const;

export function clampContextGraphEdgeLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return GRAPH_EDGE_LIMIT_DEFAULT;
  return Math.min(GRAPH_EDGE_LIMIT_MAX, Math.max(GRAPH_EDGE_LIMIT_MIN, Math.floor(limit)));
}

interface ProjectContextSnapshot {
  workspaceId: string;
  rootPath: string;
  jobs: IngestionJob[];
  chunks: CanonicalDocumentChunk[];
  registry: IdRegistryEntry[];
  artifacts: SpddArtifact[];
  runs: SpddWorkRun[];
  links: SpddTraceLink[];
  toolCalls: Awaited<ReturnType<ToolCallLogger["list"]>>;
}

export class ContextObservabilityService {
  constructor(
    private readonly workspaces: ProjectWorkspaceService,
    private readonly repository: MetadataRepository,
    private readonly toolCalls: ToolCallLogger
  ) {}

  async getFreshnessReport(project_id: string | undefined, filter: ContextObservabilityFilter = {}): Promise<ContextFreshnessReport> {
    const snap = await this.loadSnapshot(project_id, true);
    const generated_at = new Date().toISOString();
    const warnings: string[] = [];
    const signals: FreshnessSignal[] = [];

    const staleChunks = snap.chunks.filter((c) => c.status === "stale");
    const staleRegistry = snap.registry.filter((e) => e.status === "stale");
    const duplicateRegistryRows = snap.registry.filter((e) => e.status === "duplicate");
    const stableCounts = countBy(snap.registry.map((e) => e.stable_id));
    const ambiguousStableIds = [...stableCounts.entries()].filter(([, n]) => n > 1).map(([sid]) => sid);
    const unresolvedLinks = snap.links.filter((l) => l.status === "unresolved");
    const unresolvedAnchoredLinks = unresolvedLinks.filter((l) => l.target_type !== "source_path");
    const unresolvedSourcePathLinks = unresolvedLinks.filter((l) => l.target_type === "source_path");
    const staleLinks = snap.links.filter((l) => l.status === "stale");
    const missingArtifacts = snap.artifacts.filter((a) => a.status === "missing");
    const staleArtifacts = snap.artifacts.filter((a) => a.status === "stale");

    if (snap.jobs.length === 0) {
      signals.push({
        code: "never_ingested",
        severity: "warning",
        confidence: "factual",
        evidence_type: "metadata",
        message: "No ingestion jobs recorded for this project yet.",
        count: 1
      });
    }

    const completedJobs = snap.jobs.filter((j) => j.status === "completed");
    const currentChunkRows = snap.chunks.filter((c) => c.status === "current");
    if (completedJobs.length > 0 && currentChunkRows.length === 0) {
      signals.push({
        code: "metadata_empty_after_completed_ingestion",
        severity: "warning",
        confidence: "heuristic",
        evidence_type: "metadata",
        message: "Ingestion jobs completed but SQLite has no current document chunks — metadata indexing may be misconfigured or stale.",
        count: 1
      });
    }

    const lastCompleted = snap.jobs
      .filter((j) => j.status === "completed" && j.completed_at)
      .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))[0];
    const last_ingested_at = lastCompleted?.completed_at;

    if (staleChunks.length) {
      signals.push({
        code: "stale_chunks",
        severity: "warning",
        confidence: "factual",
        evidence_type: "metadata",
        message: "Indexed chunks marked stale — re-ingest affected paths.",
        count: staleChunks.length
      });
    }

    if (staleRegistry.length) {
      signals.push({
        code: "stale_id_registry_entries",
        severity: "warning",
        confidence: "factual",
        evidence_type: "metadata",
        message: "ID registry contains stale rows (deleted, moved, or hash drift).",
        count: staleRegistry.length
      });
    }

    if (duplicateRegistryRows.length || ambiguousStableIds.length) {
      signals.push({
        code: "duplicate_or_ambiguous_stable_ids",
        severity: "warning",
        confidence: "factual",
        evidence_type: "metadata",
        message: "Duplicate registry rows or ambiguous stable ID collisions detected.",
        count: duplicateRegistryRows.length + ambiguousStableIds.length
      });
    }

    if (missingArtifacts.length || staleArtifacts.length) {
      signals.push({
        code: "spdd_artifact_drift",
        severity: "warning",
        confidence: "factual",
        evidence_type: "spdd_trace",
        message: "SPDD artifact catalog reports missing or stale prompt files.",
        count: missingArtifacts.length + staleArtifacts.length
      });
    }

    if (unresolvedAnchoredLinks.length) {
      signals.push({
        code: "unresolved_trace_links",
        severity: "warning",
        confidence: "factual",
        evidence_type: "spdd_trace",
        message: "SPDD trace links reference stable IDs, chunks, tools, or memory targets that did not resolve when the run was recorded.",
        count: unresolvedAnchoredLinks.length
      });
    }

    if (unresolvedSourcePathLinks.length) {
      signals.push({
        code: "unresolved_source_path_trace_links",
        severity: "info",
        confidence: "factual",
        evidence_type: "spdd_trace",
        message: "SPDD source-path links have no stable ID or local chunk anchor; this is often normal for plain changed files.",
        count: unresolvedSourcePathLinks.length
      });
    }

    if (staleLinks.length) {
      signals.push({
        code: "stale_trace_links",
        severity: "info",
        confidence: "factual",
        evidence_type: "spdd_trace",
        message: "Some trace links are marked stale.",
        count: staleLinks.length
      });
    }

    const recentFailures = snap.jobs.slice(0, 8).filter((j) => j.status === "failed" || j.errors.length > 0);
    if (recentFailures.length) {
      signals.push({
        code: "recent_ingestion_failures",
        severity: "error",
        confidence: "factual",
        evidence_type: "metadata",
        message: "Recent ingestion jobs failed or recorded errors.",
        count: recentFailures.length
      });
    }

    const linksByRun = groupLinksByRun(snap.links);
    const runsWithoutLinks = snap.runs.filter((r) => !(linksByRun.get(r.run_id)?.length));
    if (runsWithoutLinks.length) {
      signals.push({
        code: "runs_without_trace_links",
        severity: "info",
        confidence: "factual",
        evidence_type: "spdd_trace",
        message: "Some SPDD runs have no recorded trace links (low trace granularity).",
        count: runsWithoutLinks.length
      });
    }

    const recordFailures = snap.toolCalls.filter((t) => t.tool === "record_spdd_run" && t.status === "error").length;
    if (recordFailures > 0) {
      signals.push({
        code: "record_spdd_run_failures_logged",
        severity: "warning",
        confidence: "factual",
        evidence_type: "tool_log",
        message: "Tool-call log shows failed record_spdd_run attempts.",
        count: recordFailures
      });
    }

    if (snap.artifacts.length > 0 && snap.runs.length === 0) {
      signals.push({
        code: "artifacts_without_runs",
        severity: "info",
        confidence: "heuristic",
        evidence_type: "spdd_trace",
        message: "SPDD artifacts are cataloged but no runs are recorded yet (may be normal for analysis-only work).",
        count: snap.artifacts.length
      });
    }

    await this.appendChangedFileSignals(snap, filter.changed_file_detection ?? "off", signals, warnings);

    const summary = summarizeSignals(signals, {
      stale_chunk_count: staleChunks.length,
      stale_registry_count: staleRegistry.length,
      duplicate_registry_count: duplicateRegistryRows.length + ambiguousStableIds.length,
      unresolved_trace_link_count: unresolvedLinks.length
    });

    return {
      project_id: snap.workspaceId,
      status: deriveFreshnessStatus(signals),
      generated_at,
      last_ingested_at,
      signals,
      summary,
      warnings
    };
  }

  async getQualityMetrics(project_id: string | undefined, _filter: ContextObservabilityFilter = {}): Promise<ContextQualityMetrics> {
    const snap = await this.loadSnapshot(project_id, true);
    const generated_at = new Date().toISOString();
    const warnings: MetricWarning[] = [];

    const staleChunks = snap.chunks.filter((c) => c.status === "stale");
    const staleIds = snap.registry.filter((e) => e.status === "stale");
    const dupRows = snap.registry.filter((e) => e.status === "duplicate");
    const stableCounts = countBy(snap.registry.map((e) => e.stable_id));
    const ambiguous = [...stableCounts.entries()].filter(([, n]) => n > 1).length;
    const duplicate_id_count = dupRows.length + ambiguous;

    const unresolvedLinks = snap.links.filter((l) => l.status === "unresolved");

    const linksByRun = groupLinksByRun(snap.links);
    const runsWithLinks = snap.runs.filter((r) => (linksByRun.get(r.run_id) ?? []).length > 0);
    let trace_coverage_ratio: number | undefined;
    if (snap.runs.length > 0) trace_coverage_ratio = runsWithLinks.length / snap.runs.length;
    else warnings.push({ code: "NO_RUNS", message: "No SPDD runs recorded; trace coverage ratio is omitted." });

    let unresolved_trace_link_ratio: number | undefined;
    if (snap.links.length > 0) unresolved_trace_link_ratio = unresolvedLinks.length / snap.links.length;

    let stale_chunk_ratio: number | undefined;
    if (snap.chunks.length > 0) stale_chunk_ratio = staleChunks.length / snap.chunks.length;

    let stale_id_ratio: number | undefined;
    if (snap.registry.length > 0) stale_id_ratio = staleIds.length / snap.registry.length;

    const validation_usage_count = snap.toolCalls.filter((t) => t.tool === "validate_against_specs" && t.status === "ok").length;
    const failed_tool_call_count = snap.toolCalls.filter((t) => t.status === "error").length;

    let memory_mirror_ratio: number | undefined;
    if (snap.runs.length > 0) {
      memory_mirror_ratio = snap.runs.filter((r) => Boolean(r.memory_event_id)).length / snap.runs.length;
    }

    return {
      project_id: snap.workspaceId,
      generated_at,
      stale_chunk_count: staleChunks.length,
      stale_id_count: staleIds.length,
      duplicate_id_count,
      unresolved_trace_link_count: unresolvedLinks.length,
      trace_coverage_ratio,
      unresolved_trace_link_ratio,
      stale_chunk_ratio,
      stale_id_ratio,
      validation_usage_count,
      failed_tool_call_count,
      memory_mirror_ratio,
      warnings
    };
  }

  async getContextGraph(project_id: string | undefined, filter: ContextObservabilityFilter = {}): Promise<ContextGraph> {
    const includeStale = filter.include_stale ?? false;
    assertGraphStaleStatusConsistency(includeStale, filter.status);
    validateContextGraphEdgeTypes(filter.edge_types);
    validateContextGraphLinkStatuses(filter.status);
    validateContextGraphRelations(filter.relation);

    const anchoredIntent = inferGraphAnchored(filter);
    validateAnchoringInputs(filter, anchoredIntent);
    const ordering = normalizeContextGraphOrdering(filter.ordering);

    const snap = await this.loadSnapshot(project_id, includeStale);
    const generated_at = new Date().toISOString();
    const warnings: string[] = [];
    const edgeLimit = clampContextGraphEdgeLimit(filter.limit);

    const nodeMap = new Map<string, ContextGraphNode>();
    const allEdges: ContextGraphEdge[] = [];

    const pid = snap.workspaceId;
    const projectNodeId = `project:${pid}`;
    nodeMap.set(projectNodeId, { id: projectNodeId, type: "project", label: pid, metadata: {} });

    const chunkFilter = (c: CanonicalDocumentChunk) => filter.include_stale || c.status === "current";

    const linkedProjectPaths = new Set<string>();
    const addPath = (source_path: string) => {
      const id = `path:${source_path}`;
      if (!nodeMap.has(id)) nodeMap.set(id, { id, type: "source_path", label: source_path, source_path, status: "current" });
      if (!linkedProjectPaths.has(source_path)) {
        linkedProjectPaths.add(source_path);
        allEdges.push({
          id: `edge:project_path:${source_path}`,
          type: "project_path",
          from: projectNodeId,
          to: id,
          metadata: {}
        });
      }
    };

    for (const chunk of snap.chunks.filter(chunkFilter)) {
      addPath(chunk.source_path);
      const chunkId = `chunk:${chunk.chunk_id}`;
      nodeMap.set(chunkId, {
        id: chunkId,
        type: "chunk",
        label: chunk.source_path,
        status: chunk.status,
        source_path: chunk.source_path,
        metadata: { document_type: chunk.document_type, chunk_id: chunk.chunk_id }
      });
      allEdges.push({
        id: `edge:path_chunk:${chunk.chunk_id}`,
        type: "path_chunk",
        from: `path:${chunk.source_path}`,
        to: chunkId,
        metadata: {}
      });
      for (const sid of chunk.stable_ids ?? []) {
        const sidId = `stable_id:${sid}`;
        if (!nodeMap.has(sidId)) nodeMap.set(sidId, { id: sidId, type: "stable_id", label: sid, stable_id: sid, status: "current" });
        allEdges.push({
          id: `edge:chunk_stable:${chunk.chunk_id}:${sid}`,
          type: "chunk_stable",
          from: chunkId,
          to: sidId,
          metadata: {}
        });
      }
    }

    for (const entry of snap.registry) {
      addPath(entry.source_path);
      const regNode = `registry:${entry.stable_id}:${entry.source_path}:${entry.line_start ?? 0}`;
      nodeMap.set(regNode, {
        id: regNode,
        type: "stable_id",
        label: entry.stable_id,
        stable_id: entry.stable_id,
        source_path: entry.source_path,
        status: entry.status,
        metadata: { line_start: entry.line_start, category: entry.category, registry_row: true }
      });
      allEdges.push({
        id: `edge:path_registry:${entry.stable_id}:${entry.source_path}:${entry.line_start ?? 0}`,
        type: "path_registry",
        from: `path:${entry.source_path}`,
        to: regNode,
        metadata: {}
      });
    }

    for (const artifact of snap.artifacts) {
      const id = `spdd_artifact:${artifact.artifact_id}`;
      nodeMap.set(id, {
        id,
        type: "spdd_artifact",
        label: artifact.title ?? artifact.source_path,
        source_path: artifact.source_path,
        status: artifact.status,
        metadata: { artifact_type: artifact.artifact_type }
      });
      addPath(artifact.source_path);
      allEdges.push({
        id: `edge:path_spdd_art:${artifact.artifact_id}`,
        type: "path_spdd_artifact",
        from: `path:${artifact.source_path}`,
        to: id,
        metadata: {}
      });
    }

    for (const run of snap.runs) {
      const id = `spdd_run:${run.run_id}`;
      nodeMap.set(id, {
        id,
        type: "spdd_run",
        label: run.title,
        status: run.status,
        metadata: { completed_at: run.completed_at }
      });
      if (run.artifact_id) {
        allEdges.push({
          id: `edge:art_run:${run.artifact_id}:${run.run_id}`,
          type: "artifact_run",
          from: `spdd_artifact:${run.artifact_id}`,
          to: id,
          metadata: {}
        });
      } else if (run.artifact_path) {
        addPath(run.artifact_path);
        allEdges.push({
          id: `edge:path_run:${run.run_id}`,
          type: "path_run",
          from: `path:${run.artifact_path}`,
          to: id,
          metadata: {}
        });
      } else {
        allEdges.push({
          id: `edge:project_run:${run.run_id}`,
          type: "project_run",
          from: projectNodeId,
          to: id,
          metadata: {}
        });
      }
    }

    const toolRef = new Set<string>();
    for (const link of snap.links) {
      if (link.target_type === "tool_call") toolRef.add(link.target_id);
    }

    for (const link of snap.links) {
      const from = `spdd_run:${link.run_id}`;
      if (!nodeMap.has(from)) continue;
      const { edgeTo } = traceTargetNode(link, nodeMap, addPath);
      allEdges.push({
        id: `edge:run_trace:${link.link_id}`,
        type: "run_trace",
        from,
        to: edgeTo,
        status: link.status,
        relation: link.relation,
        metadata: { target_type: link.target_type }
      });
    }

    for (const tc of snap.toolCalls) {
      if (!toolRef.has(tc.call_id)) continue;
      const id = `tool_call:${tc.call_id}`;
      nodeMap.set(id, {
        id,
        type: "tool_call",
        label: tc.tool,
        status: tc.status,
        metadata: { duration_ms: tc.duration_ms, created_at: tc.created_at }
      });
    }

    const edgeOrdinal = new Map<string, number>();
    allEdges.forEach((e, i) => edgeOrdinal.set(e.id, i));

    const runCompletedAt = new Map(snap.runs.map((r) => [r.run_id, r.completed_at]));

    let spatialEdges = filterEdgesForTraversal(allEdges, filter);
    let rootSet = new Set<string>();

    if (anchoredIntent) {
      const depth = resolveAnchoredDepth(filter.depth);
      const resolved = resolveGraphRoots(filter, snap);
      warnings.push(...resolved.warnings);
      rootSet = resolved.roots;
      if (rootSet.size === 0) {
        warnings.push("GRAPH_ROOT_NOT_FOUND");
        spatialEdges = [];
      } else {
        spatialEdges = inducedNeighborhoodEdges(spatialEdges, rootSet, depth);
      }
    }

    let edgesOut = sortEdgesForGraph(spatialEdges, ordering, edgeOrdinal, runCompletedAt, nodeMap);

    if (edgesOut.length > edgeLimit) {
      warnings.push("GRAPH_TRUNCATED_BY_LIMIT");
      edgesOut = edgesOut.slice(0, edgeLimit);
    }

    const nodeIds = new Set<string>([projectNodeId]);
    for (const e of edgesOut) {
      nodeIds.add(e.from);
      nodeIds.add(e.to);
    }
    let nodesOut = [...nodeMap.values()].filter((n) => nodeIds.has(n.id));

    if (filter.types?.length) {
      const allow = new Set(filter.types);
      allow.add("project");
      for (const rid of rootSet) {
        const node = nodeMap.get(rid);
        if (node) allow.add(node.type);
      }
      nodesOut = nodesOut.filter((n) => n.id === projectNodeId || rootSet.has(n.id) || allow.has(n.type));
      const idset = new Set(nodesOut.map((n) => n.id));
      edgesOut = edgesOut.filter((e) => idset.has(e.from) && idset.has(e.to));
      const used = new Set<string>();
      for (const e of edgesOut) {
        used.add(e.from);
        used.add(e.to);
      }
      nodesOut = nodesOut.filter((n) => n.id === projectNodeId || rootSet.has(n.id) || used.has(n.id));
    }

    return {
      project_id: pid,
      generated_at,
      nodes: nodesOut,
      edges: edgesOut,
      warnings
    };
  }

  private async loadSnapshot(project_id: string | undefined, traceIncludeStale: boolean): Promise<ProjectContextSnapshot> {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    const filter: SpddTraceFilter = { include_stale: traceIncludeStale, limit: 200 };
    const [jobs, chunks, registry, artifacts, runs, links, toolCalls] = await Promise.all([
      this.repository.listRecentJobs(workspace.project_id),
      this.repository.listChunks(workspace.project_id),
      this.repository.listRegistryEntries(workspace.project_id),
      this.repository.listSpddArtifacts(workspace.project_id, filter),
      this.repository.listSpddWorkRuns(workspace.project_id, filter),
      this.repository.listSpddTraceLinks(workspace.project_id, filter),
      this.toolCalls.list(workspace.project_id)
    ]);
    return {
      workspaceId: workspace.project_id,
      rootPath: workspace.rootPath,
      jobs,
      chunks,
      registry,
      artifacts,
      runs,
      links,
      toolCalls
    };
  }

  private async appendChangedFileSignals(
    snap: ProjectContextSnapshot,
    mode: ChangedFileDetectionMode,
    signals: FreshnessSignal[],
    warningsOut: string[]
  ): Promise<void> {
    if (mode === "off") return;
    const attemptGit = mode === "git" || mode === "auto";
    if (!attemptGit) return;

    const gitResult = gitWorkingTreePaths(snap.rootPath);
    if (!gitResult.ok) {
      if (mode === "auto") {
        signals.push({
          code: "changed_file_scan_unavailable",
          severity: "info",
          confidence: "unavailable",
          evidence_type: "git",
          message: `Cannot compare working tree to index metadata: ${gitResult.reason}`,
          count: 1
        });
      } else {
        warningsOut.push(`Git working tree scan failed: ${gitResult.reason}`);
      }
      return;
    }

    const config = loadProjectConfig(snap.rootPath);
    const indexedByPath = new Map(snap.chunks.map((c) => [c.source_path, c]));
    const risky: string[] = [];
    for (const p of gitResult.paths) {
      const norm = p.replaceAll("\\", "/");
      if (norm.startsWith(".project-context/")) continue;
      if (!isProjectIndexablePath(norm, config)) continue;
      const chunk = indexedByPath.get(norm);
      if (!chunk || chunk.status === "stale") risky.push(norm);
    }

    if (risky.length) {
      signals.push({
        code: "changed_files_not_indexed_or_stale",
        severity: "warning",
        confidence: "heuristic",
        evidence_type: "git",
        message: "Git reports indexable changed or untracked paths with no current chunk row (re-run changed ingestion).",
        count: risky.length,
        source_paths: risky.slice(0, 40)
      });
    }
  }
}

function normalizeGraphPath(p: string): string {
  return p.replaceAll("\\", "/").trim();
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function countShortcutFields(filter: ContextObservabilityFilter): number {
  let n = 0;
  if (filter.run_id?.trim()) n++;
  if (filter.artifact_path?.trim()) n++;
  if (filter.source_path?.trim()) n++;
  if (filter.stable_id?.trim()) n++;
  if (filter.feature_ref?.trim()) n++;
  return n;
}

function inferGraphAnchored(filter: ContextObservabilityFilter): boolean {
  if (filter.mode === "snapshot") return false;
  if (filter.mode === "anchored") return true;
  const explicitPair = Boolean(filter.root_type && filter.root_id?.trim());
  return explicitPair || countShortcutFields(filter) > 0;
}

function validateAnchoringInputs(filter: ContextObservabilityFilter, anchoredIntent: boolean): void {
  const rt = filter.root_type;
  const rid = filter.root_id?.trim();
  const explicitPair = Boolean(rt && rid);
  const partialExplicit = Boolean(rt && !rid) || Boolean(!rt && filter.root_id?.trim());

  if (partialExplicit) {
    throw new PlatformError("VALIDATION_ERROR", "Graph root_type and root_id must both be set.", { details: {} });
  }

  const sc = countShortcutFields(filter);

  if (filter.mode === "anchored") {
    if (!explicitPair && sc === 0) {
      throw new PlatformError("VALIDATION_ERROR", "Anchored graph mode requires root_type/root_id or one shortcut anchor.", {
        details: {}
      });
    }
  }

  if (!anchoredIntent) return;

  if (explicitPair && sc > 1) {
    throw new PlatformError("VALIDATION_ERROR", "Multiple graph anchor shortcuts supplied.", { details: {} });
  }

  if (!explicitPair && sc > 1) {
    throw new PlatformError("VALIDATION_ERROR", "Multiple graph anchor shortcuts supplied.", { details: {} });
  }
}

function resolveExplicitRootNodes(rt: ContextGraphRootType, rid: string, snap: ProjectContextSnapshot): Set<string> {
  switch (rt) {
    case "run": {
      if (!snap.runs.some((r) => r.run_id === rid)) return new Set();
      return new Set([`spdd_run:${rid}`]);
    }
    case "artifact": {
      const byId = snap.artifacts.find((a) => a.artifact_id === rid);
      if (byId) return new Set([`spdd_artifact:${byId.artifact_id}`]);
      const path = normalizeGraphPath(rid);
      const hits = snap.artifacts.filter((a) => a.source_path === path);
      return new Set(hits.map((h) => `spdd_artifact:${h.artifact_id}`));
    }
    case "source_path":
      return new Set([`path:${normalizeGraphPath(rid)}`]);
    case "stable_id": {
      const roots = new Set<string>();
      roots.add(`stable_id:${rid}`);
      for (const e of snap.registry) {
        if (e.stable_id === rid) roots.add(`registry:${e.stable_id}:${e.source_path}:${e.line_start ?? 0}`);
      }
      return roots;
    }
    case "feature":
      return new Set([`feature_ref:${rid.trim()}`]);
    default:
      return new Set();
  }
}

function resolveShortcutRoots(filter: ContextObservabilityFilter, snap: ProjectContextSnapshot): Set<string> {
  if (filter.run_id?.trim()) return resolveExplicitRootNodes("run", filter.run_id.trim(), snap);
  if (filter.artifact_path?.trim()) return resolveExplicitRootNodes("artifact", normalizeGraphPath(filter.artifact_path!), snap);
  if (filter.source_path?.trim()) return resolveExplicitRootNodes("source_path", normalizeGraphPath(filter.source_path!), snap);
  if (filter.stable_id?.trim()) return resolveExplicitRootNodes("stable_id", filter.stable_id.trim(), snap);
  if (filter.feature_ref?.trim()) return resolveExplicitRootNodes("feature", filter.feature_ref.trim(), snap);
  return new Set();
}

function resolveGraphRoots(filter: ContextObservabilityFilter, snap: ProjectContextSnapshot): { roots: Set<string>; warnings: string[] } {
  const warnings: string[] = [];
  const explicitPair = Boolean(filter.root_type && filter.root_id?.trim());
  const sc = countShortcutFields(filter);

  if (explicitPair) {
    const rt = filter.root_type!;
    const rid = filter.root_id!.trim();
    const roots = resolveExplicitRootNodes(rt, rid, snap);
    if (rt === "stable_id") {
      const regHits = snap.registry.filter((e) => e.stable_id === rid);
      if (regHits.length > 1) warnings.push("GRAPH_AMBIGUOUS_STABLE_ID");
    }
    if (sc === 1) {
      const shortcutRoots = resolveShortcutRoots(filter, snap);
      if (!setsEqual(roots, shortcutRoots)) {
        throw new PlatformError("VALIDATION_ERROR", "Graph anchor shortcut conflicts with root_type/root_id.", {
          details: { explicit: [...roots].sort(), shortcut: [...shortcutRoots].sort() }
        });
      }
    }
    return { roots, warnings };
  }

  if (sc === 1) {
    const roots = resolveShortcutRoots(filter, snap);
    const sid = filter.stable_id?.trim();
    if (sid) {
      const regHits = snap.registry.filter((e) => e.stable_id === sid);
      if (regHits.length > 1) warnings.push("GRAPH_AMBIGUOUS_STABLE_ID");
    }
    return { roots, warnings };
  }

  return { roots: new Set(), warnings };
}

function filterEdgesForTraversal(edges: ContextGraphEdge[], filter: ContextObservabilityFilter): ContextGraphEdge[] {
  const edgeAllow = filter.edge_types?.length ? new Set(filter.edge_types) : null;
  const statusAllow = filter.status?.length ? new Set(filter.status) : null;
  const relationAllow = filter.relation?.length ? new Set(filter.relation) : null;

  return edges.filter((e) => {
    if (edgeAllow && !edgeAllow.has(e.type)) return false;
    if (e.type !== "run_trace") return true;
    if (statusAllow && e.status && !statusAllow.has(e.status)) return false;
    if (relationAllow && (!e.relation || !relationAllow.has(e.relation))) return false;
    return true;
  });
}

function inducedNeighborhoodEdges(edges: ContextGraphEdge[], roots: Set<string>, depth: number): ContextGraphEdge[] {
  const adj = new Map<string, Set<string>>();
  const addAdj = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const e of edges) {
    addAdj(e.from, e.to);
  }

  const dist = new Map<string, number>();
  const queue = [...roots];
  for (const r of roots) dist.set(r, 0);

  while (queue.length) {
    const u = queue.shift()!;
    const d = dist.get(u)!;
    if (d >= depth) continue;
    for (const v of adj.get(u) ?? []) {
      if (!dist.has(v)) {
        dist.set(v, d + 1);
        queue.push(v);
      }
    }
  }

  const verts = new Set([...dist.entries()].filter(([, d]) => d <= depth).map(([v]) => v));
  return edges.filter((e) => verts.has(e.from) && verts.has(e.to));
}

function maxRunCompletedIso(edge: ContextGraphEdge, runCompletedAt: Map<string, string>): string {
  let best = "";
  for (const nid of [edge.from, edge.to]) {
    const m = /^spdd_run:(.+)$/.exec(nid);
    if (!m) continue;
    const iso = runCompletedAt.get(m[1]) ?? "";
    if (iso.localeCompare(best) > 0) best = iso;
  }
  return best;
}

function edgeStableAnchored(edge: ContextGraphEdge, nodeMap: Map<string, ContextGraphNode>): boolean {
  if (edge.type === "chunk_stable" || edge.type === "path_registry") return true;
  if (edge.type === "run_trace" && edge.metadata?.target_type === "stable_id") return true;
  const na = nodeMap.get(edge.from);
  const nb = nodeMap.get(edge.to);
  return nodeStableAnchored(na) || nodeStableAnchored(nb);
}

function nodeStableAnchored(n?: ContextGraphNode): boolean {
  if (!n) return false;
  if (n.type === "stable_id") return true;
  if (n.id.startsWith("registry:")) return true;
  return false;
}

function sortEdgesForGraph(
  edges: ContextGraphEdge[],
  ordering: ContextGraphOrdering,
  edgeOrdinal: Map<string, number>,
  runCompletedAt: Map<string, string>,
  nodeMap: Map<string, ContextGraphNode>
): ContextGraphEdge[] {
  const sorted = [...edges];
  const tie = (a: ContextGraphEdge, b: ContextGraphEdge) => (edgeOrdinal.get(a.id) ?? 0) - (edgeOrdinal.get(b.id) ?? 0);

  switch (ordering) {
    case "default":
      sorted.sort(tie);
      break;
    case "newest_runs_first":
      sorted.sort((a, b) => {
        const tb = maxRunCompletedIso(b, runCompletedAt).localeCompare(maxRunCompletedIso(a, runCompletedAt));
        if (tb !== 0) return tb;
        return tie(a, b);
      });
      break;
    case "unresolved_first":
      sorted.sort((a, b) => {
        const pa = a.type === "run_trace" && a.status === "unresolved" ? 0 : 1;
        const pb = b.type === "run_trace" && b.status === "unresolved" ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return tie(a, b);
      });
      break;
    case "stable_id_anchored_first":
      sorted.sort((a, b) => {
        const pa = edgeStableAnchored(a, nodeMap) ? 0 : 1;
        const pb = edgeStableAnchored(b, nodeMap) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return tie(a, b);
      });
      break;
    default:
      sorted.sort(tie);
  }

  return sorted;
}

function traceTargetNode(
  link: SpddTraceLink,
  nodeMap: Map<string, ContextGraphNode>,
  addPath: (p: string) => void
): { edgeTo: string } {
  switch (link.target_type) {
    case "stable_id": {
      const id = `stable_id:${link.target_id}`;
      if (!nodeMap.has(id)) nodeMap.set(id, { id, type: "stable_id", label: link.target_id, stable_id: link.target_id, status: link.status });
      return { edgeTo: id };
    }
    case "source_path": {
      addPath(link.target_id);
      return { edgeTo: `path:${link.target_id}` };
    }
    case "chunk": {
      const id = `chunk:${link.target_id}`;
      if (!nodeMap.has(id)) nodeMap.set(id, { id, type: "chunk", label: link.target_id, status: link.status, metadata: { unresolved: true } });
      return { edgeTo: id };
    }
    case "feature": {
      const id = `feature_ref:${link.target_id}`;
      if (!nodeMap.has(id)) nodeMap.set(id, { id, type: "feature_ref", label: link.target_id, status: link.status });
      return { edgeTo: id };
    }
    case "tool_call": {
      const id = `tool_call:${link.target_id}`;
      if (!nodeMap.has(id)) nodeMap.set(id, { id, type: "tool_call", label: link.target_id, status: link.status, metadata: { unresolved: true } });
      return { edgeTo: id };
    }
    case "memory_event": {
      const id = `memory_event:${link.target_id}`;
      if (!nodeMap.has(id)) nodeMap.set(id, { id, type: "memory_event", label: link.target_id, status: link.status });
      return { edgeTo: id };
    }
    default: {
      const id = `trace_target:${link.target_type}:${link.target_id}`;
      if (!nodeMap.has(id)) {
        nodeMap.set(id, {
          id,
          type: "trace_target",
          label: link.target_id,
          status: link.status,
          metadata: { target_type: link.target_type }
        });
      }
      return { edgeTo: id };
    }
  }
}

function groupLinksByRun(links: SpddTraceLink[]): Map<string, SpddTraceLink[]> {
  const m = new Map<string, SpddTraceLink[]>();
  for (const l of links) {
    const arr = m.get(l.run_id) ?? [];
    arr.push(l);
    m.set(l.run_id, arr);
  }
  return m;
}

function countBy(keys: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

function summarizeSignals(
  signals: FreshnessSignal[],
  extras: Pick<FreshnessSummary, "stale_chunk_count" | "stale_registry_count" | "duplicate_registry_count" | "unresolved_trace_link_count">
): FreshnessSummary {
  const error_count = signals.filter((s) => s.severity === "error").length;
  const warning_count = signals.filter((s) => s.severity === "warning").length;
  const info_count = signals.filter((s) => s.severity === "info").length;
  return {
    total_signals: signals.length,
    error_count,
    warning_count,
    info_count,
    ...extras
  };
}

function deriveFreshnessStatus(signals: FreshnessSignal[]): ContextFreshnessStatus {
  if (!signals.length) return "unknown";
  if (signals.some((s) => s.severity === "error")) return "stale";
  if (signals.some((s) => s.severity === "warning")) return "warning";
  return "fresh";
}
