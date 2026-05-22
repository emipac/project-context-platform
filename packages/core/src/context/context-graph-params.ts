import { PlatformError } from "../errors/platform-error.js";

/** Declared edge `type` strings emitted by `ContextObservabilityService` graph builder. */
export const CONTEXT_GRAPH_EDGE_TYPES = [
  "project_path",
  "path_chunk",
  "chunk_stable",
  "path_registry",
  "path_spdd_artifact",
  "artifact_run",
  "path_run",
  "project_run",
  "run_trace"
] as const;

export type ContextGraphEdgeType = (typeof CONTEXT_GRAPH_EDGE_TYPES)[number];

export const CONTEXT_GRAPH_QUERY_MODES = ["snapshot", "anchored"] as const;
export type ContextGraphQueryMode = (typeof CONTEXT_GRAPH_QUERY_MODES)[number];

export const CONTEXT_GRAPH_ORDERINGS = [
  "default",
  "newest_runs_first",
  "unresolved_first",
  "stable_id_anchored_first"
] as const;
export type ContextGraphOrdering = (typeof CONTEXT_GRAPH_ORDERINGS)[number];

/** Public root kinds accepted by REST/MCP (aliases normalized separately). */
export const CONTEXT_GRAPH_ROOT_TYPES = ["run", "artifact", "source_path", "stable_id", "feature"] as const;
export type ContextGraphRootType = (typeof CONTEXT_GRAPH_ROOT_TYPES)[number];

export const CONTEXT_GRAPH_LINK_STATUSES = ["current", "stale", "unresolved"] as const;

export const CONTEXT_GRAPH_QUERY_MAX_DEPTH = 4;

export const CONTEXT_GRAPH_TRACE_RELATIONS = [
  "retrieved",
  "referenced",
  "implemented",
  "changed",
  "reviewed",
  "validated",
  "summarized"
] as const;

const EDGE_SET = new Set<string>(CONTEXT_GRAPH_EDGE_TYPES as unknown as string[]);
const ORDERING_SET = new Set<string>(CONTEXT_GRAPH_ORDERINGS as unknown as string[]);
const ROOT_SET = new Set<string>(CONTEXT_GRAPH_ROOT_TYPES as unknown as string[]);
const RELATION_SET = new Set<string>(CONTEXT_GRAPH_TRACE_RELATIONS as unknown as string[]);
const STATUS_SET = new Set<string>(CONTEXT_GRAPH_LINK_STATUSES as unknown as string[]);

export function normalizeContextGraphRootType(raw: string): ContextGraphRootType {
  const n = raw.trim();
  if (n === "spdd_run" || n === "run") return "run";
  if (n === "spdd_artifact" || n === "artifact") return "artifact";
  if (n === "feature_ref" || n === "feature") return "feature";
  if (n === "source_path" || n === "stable_id") return n;
  if (ROOT_SET.has(n)) return n as ContextGraphRootType;
  throw new PlatformError("VALIDATION_ERROR", "Invalid graph root_type.", {
    details: { invalid: raw, allowed: [...CONTEXT_GRAPH_ROOT_TYPES] }
  });
}

/** Normalize graph node `types[]` aliases (REST/MCP) to internal node `type` strings. */
export function normalizeContextGraphNodeType(type: string): string {
  const normalized = type.trim();
  if (normalized === "artifact") return "spdd_artifact";
  if (normalized === "run") return "spdd_run";
  if (normalized === "feature") return "feature_ref";
  return normalized;
}

export function normalizeContextGraphQueryMode(raw: string | undefined): ContextGraphQueryMode | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = raw.trim() as ContextGraphQueryMode;
  if (CONTEXT_GRAPH_QUERY_MODES.includes(n as ContextGraphQueryMode)) return n as ContextGraphQueryMode;
  throw new PlatformError("VALIDATION_ERROR", "Invalid graph mode.", {
    details: { invalid: raw, allowed: [...CONTEXT_GRAPH_QUERY_MODES] }
  });
}

export function normalizeContextGraphOrdering(raw: string | undefined): ContextGraphOrdering {
  if (raw === undefined || raw.trim() === "") return "default";
  const n = raw.trim() as ContextGraphOrdering;
  if (CONTEXT_GRAPH_ORDERINGS.includes(n as ContextGraphOrdering)) return n as ContextGraphOrdering;
  throw new PlatformError("VALIDATION_ERROR", "Invalid graph ordering.", {
    details: { invalid: raw, allowed: [...CONTEXT_GRAPH_ORDERINGS] }
  });
}

/** Split comma-separated query tokens; trims empties. */
export function splitCommaQuery(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

export function validateContextGraphEdgeTypes(edge_types: string[] | undefined): void {
  if (!edge_types?.length) return;
  const invalid = edge_types.filter((t) => !EDGE_SET.has(t));
  if (invalid.length) {
    throw new PlatformError("VALIDATION_ERROR", "Invalid graph edge_types.", {
      details: { invalid, allowed: [...CONTEXT_GRAPH_EDGE_TYPES] }
    });
  }
}

export function validateContextGraphLinkStatuses(statuses: string[] | undefined): void {
  if (!statuses?.length) return;
  const invalid = statuses.filter((t) => !STATUS_SET.has(t));
  if (invalid.length) {
    throw new PlatformError("VALIDATION_ERROR", "Invalid graph status filter.", {
      details: { invalid, allowed: [...CONTEXT_GRAPH_LINK_STATUSES] }
    });
  }
}

export function validateContextGraphRelations(relations: string[] | undefined): void {
  if (!relations?.length) return;
  const invalid = relations.filter((t) => !RELATION_SET.has(t));
  if (invalid.length) {
    throw new PlatformError("VALIDATION_ERROR", "Invalid graph relation filter.", {
      details: { invalid, allowed: [...CONTEXT_GRAPH_TRACE_RELATIONS] }
    });
  }
}

/**
 * Reject asking for stale trace edges while stale trace rows are excluded from the snapshot (`include_stale` false).
 */
export function assertGraphStaleStatusConsistency(include_stale: boolean, statusFilter: string[] | undefined): void {
  if (!statusFilter?.includes("stale")) return;
  if (!include_stale) {
    throw new PlatformError("VALIDATION_ERROR", "Graph status filter includes stale but include_stale is false.", {
      details: { statusFilter }
    });
  }
}

export function resolveAnchoredDepth(depth: number | undefined): number {
  if (depth === undefined || !Number.isFinite(depth)) return 2;
  const d = Math.floor(depth);
  if (d < 0 || d > CONTEXT_GRAPH_QUERY_MAX_DEPTH) {
    throw new PlatformError("VALIDATION_ERROR", "Invalid graph depth.", {
      details: { depth, min: 0, max: CONTEXT_GRAPH_QUERY_MAX_DEPTH }
    });
  }
  return d;
}
