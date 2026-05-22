export type WorkspaceStatus = "active" | "inactive" | "archived";
export type IngestionMode = "full" | "changed" | "document";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "blocked";
export type IdCategory = "REQ" | "TASK" | "ADR" | "DEC" | "REQCHG" | "REV" | "IMPL" | "AC" | "NFR" | "DP";
export type RegistryEntryStatus = "current" | "stale" | "duplicate";
export type ChunkStatus = "current" | "stale";

/** Granular ingest chunk classifier (Markdown strategies); optional on file-level chunks. */
export type ChunkKind = "file" | "markdown_section" | "stable_id_anchor" | "markdown_table_row";
export type MemoryEventType = "decision" | "requirement_change" | "review_finding" | "implementation_summary" | "approval";
export type EventStatus = "current" | "superseded" | "deprecated";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "needs_changes";
export type ApprovalDecision = "approved" | "rejected" | "needs_changes";
export type Severity = "low" | "medium" | "high" | "critical";
export type ReviewFindingStatus = "open" | "resolved" | "accepted" | "rejected";
export type ImplSummaryStatus = "planned" | "in_progress" | "completed" | "reverted";
export type RiskClassification = "low_risk" | "high_risk";
export type InterfaceKind = "mcp" | "rest" | "cli" | "web";
export type CallStatus = "ok" | "error";

import type {
  ContextGraphOrdering,
  ContextGraphQueryMode,
  ContextGraphRootType
} from "../context/context-graph-params.js";

export interface ProjectWorkspace {
  project_id: string;
  name: string;
  rootPath: string;
  status: WorkspaceStatus;
  registryPath?: string;
  configPath: string;
  lightragIndexPath: string;
  graphitiNamespace: string;
  metadataDbPath: string;
  idRegistryPath: string;
  toolCallLogPath: string;
  available?: boolean;
  unavailable_reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IndexingConfig {
  include: string[];
  ignore: string[];
  max_chunks_per_section: number;
  duplicate_id_policy: "warn" | "fail";
}

export interface IdsConfig {
  required_prefixes: string[];
  project_domain: string;
  legacy_patterns: {
    adr_headings: boolean;
    adr_filenames: boolean;
    use_cases: boolean;
    plan_items: boolean;
  };
}

export interface ProjectConfig {
  indexing: IndexingConfig;
  ids: IdsConfig;
  lightrag: { index_path: string; timeout_ms: number; base_url: string; health_path: string };
  graphiti: { namespace: string; timeout_ms: number; base_url: string; health_path: string };
  memory: { high_risk_types: string[]; low_risk_types: string[] };
  api: { host: string; port: number; auth_token?: string };
  ui: { enabled: boolean };
}

export interface IngestionJob {
  job_id: string;
  project_id: string;
  mode: IngestionMode;
  status: JobStatus;
  requested_by: string;
  requires_confirmation: boolean;
  files_scanned: number;
  files_indexed: number;
  warnings: string[];
  errors: string[];
  started_at: string;
  completed_at?: string;
}

export interface IdRegistryEntry {
  project_id: string;
  stable_id: string;
  aliases?: string[];
  category: IdCategory;
  domain: string;
  source_path: string;
  heading?: string;
  line_start?: number;
  line_end?: number;
  status: RegistryEntryStatus;
  stale_reason?: "deleted" | "moved" | "hash_mismatch" | "duplicate";
  first_seen_at: string;
  last_seen_at: string;
}

/** Runtime process snapshot for `/health` and MCP diagnostics (additive fields allowed). */
export interface RuntimeIdentityDTO {
  generated_at: string;
  node_version: string;
  platform: string;
  pid: number;
  cwd?: string;
  adapter_mode: string;
  build_revision?: string;
}

export interface CanonicalDocumentChunk {
  project_id: string;
  chunk_id: string;
  source_path: string;
  heading?: string;
  stable_ids: string[];
  content: string;
  document_type: string;
  domain: string;
  status: ChunkStatus;
  stale_reason?: string;
  created_at: string;
  updated_at: string;
  chunk_kind?: ChunkKind;
  chunk_index?: number;
  chunk_total?: number;
  line_start?: number;
  line_end?: number;
  content_hash?: string;
}

export interface ToolCallLogEntry {
  project_id: string | null;
  call_id: string;
  interface: InterfaceKind;
  tool: string;
  status: CallStatus;
  duration_ms: number;
  input_summary: Record<string, unknown>;
  result_summary: Record<string, unknown>;
  created_at: string;
}

export interface StructuredPlatformError {
  code: string;
  message: string;
  details: Record<string, unknown>;
  project_id: string | null;
  retryable: boolean;
}

export type RetrievalMode = "fast" | "semantic" | "deep";

export interface FeatureContextRequestDTO {
  feature_name: string;
  optional_requirement_ids?: string[];
  optional_task_id?: string;
  retrieval_mode?: RetrievalMode;
  document_types?: string[];
  source_path_prefixes?: string[];
  chunk_kinds?: string[];
}

export interface FeatureContextResponseDTO {
  feature: string;
  relevant_prd_sections: unknown[];
  relevant_srs_sections: unknown[];
  related_adrs: unknown[];
  api_contracts: unknown[];
  database_context: unknown[];
  related_code: unknown[];
  related_tests: unknown[];
  current_decisions: unknown[];
  deprecated_decisions: unknown[];
  open_questions: unknown[];
  known_review_findings: unknown[];
  implementation_checklist: unknown[];
  traceability: unknown[];
  warnings?: string[];
}

/** MCP / REST input for `validate_against_specs`; fields are additive for backward compatibility. */
export interface ValidateAgainstSpecsInput {
  plan?: string;
  diff?: string;
  requirement_ids?: string[];
  artifact_path?: string;
  changed_files?: string[];
  source_paths?: string[];
  mode?: "fast" | "strict";
}

export type ValidationFindingSeverity = "info" | "warning" | "error";

export interface ValidationFinding {
  severity: ValidationFindingSeverity;
  code: string;
  message: string;
  evidence?: unknown[];
}

export type ValidationConfidence = "low" | "medium" | "high";

/** Structured evidence-style validation result (deterministic; still heuristic overall). */
export interface ValidateAgainstSpecsResult {
  project_id: string;
  valid: boolean;
  confidence: ValidationConfidence;
  heuristic: true;
  checked_requirement_ids: string[];
  checked_sources: string[];
  findings: ValidationFinding[];
  missing_evidence: string[];
  warnings: string[];
}

export interface MemoryReviewPreviewDTO {
  normalized_payload: Record<string, unknown>;
  warnings: Array<Record<string, unknown>>;
  risk_tier: RiskClassification;
}

export interface ExtractedId {
  stable_id: string;
  aliases?: string[];
  category: IdCategory;
  domain: string;
  source_path: string;
  heading?: string;
  line_start?: number;
  line_end?: number;
}

export interface MergeResult {
  entries: IdRegistryEntry[];
  duplicates: IdRegistryEntry[];
  warnings: string[];
}

export interface ValidationReport {
  project_id: string;
  valid: boolean;
  duplicates: IdRegistryEntry[];
  warnings: string[];
}

/** Filters for read-only stable ID registry lookup (MCP list_stable_ids). */
export interface StableIdLookupFilter {
  category?: IdCategory;
  domain?: string;
  source_path?: string;
  status?: RegistryEntryStatus;
  include_stale?: boolean;
  include_aliases?: boolean;
  limit?: number;
}

export interface StableIdLookupResponse {
  project_id: string;
  filters: StableIdLookupFilter;
  total: number;
  entries: IdRegistryEntry[];
  warnings: string[];
}

export interface DeleteProjectResultDTO {
  project_id: string;
  removedFromCatalog: boolean;
  removedFromRegistry: boolean;
  sqliteDeleted: boolean;
  lightragDeleted: boolean;
  graphitiDeleted: boolean;
  projectContextDeleted: boolean;
  warnings: string[];
}

export type SpddArtifactType = "prompt" | "analysis" | "plan" | "review" | "unknown";
export type SpddArtifactStatus = "current" | "stale" | "missing";
export type SpddWorkRunStatus = "planned" | "in_progress" | "completed" | "reverted" | "superseded";
export type SpddTraceTargetType = "stable_id" | "source_path" | "chunk" | "feature" | "tool_call" | "memory_event";
export type SpddTraceRelation = "retrieved" | "referenced" | "implemented" | "changed" | "reviewed" | "validated" | "summarized";

export interface SpddArtifact {
  project_id: string;
  artifact_id: string;
  artifact_type: SpddArtifactType;
  source_path: string;
  title?: string;
  stable_ids: string[];
  content_hash: string;
  status: SpddArtifactStatus;
  first_seen_at: string;
  last_seen_at: string;
}

export interface SpddWorkRun {
  project_id: string;
  run_id: string;
  artifact_id?: string;
  artifact_path?: string;
  title: string;
  summary: string;
  status: SpddWorkRunStatus;
  actor?: string;
  channel?: string;
  started_at?: string;
  completed_at: string;
  memory_event_id?: string;
}

export interface SpddTraceLink {
  project_id: string;
  link_id: string;
  run_id: string;
  target_type: SpddTraceTargetType;
  target_id: string;
  relation: SpddTraceRelation;
  source_path?: string;
  chunk_id?: string;
  stable_id?: string;
  status: "current" | "stale" | "unresolved";
  created_at: string;
}

export interface RecordSpddRunDTO {
  artifact_id?: string;
  artifact_path?: string;
  title?: string;
  summary: string;
  status?: SpddWorkRunStatus;
  actor?: string;
  channel?: string;
  stable_ids?: string[];
  source_paths?: string[];
  chunk_ids?: string[];
  feature_refs?: string[];
  tool_call_ids?: string[];
  memory_event_ids?: string[];
  relation?: SpddTraceRelation;
  mirror_to_memory?: boolean;
}

export interface SpddTraceFilter {
  run_id?: string;
  artifact_id?: string;
  artifact_path?: string;
  stable_id?: string;
  source_path?: string;
  chunk_id?: string;
  feature_ref?: string;
  artifact_type?: SpddArtifactType;
  target_type?: SpddTraceTargetType;
  target_id?: string;
  include_stale?: boolean;
  limit?: number;
}

export interface SpddTraceResponse {
  artifacts: SpddArtifact[];
  runs: SpddWorkRun[];
  links: SpddTraceLink[];
  warnings: string[];
}

/** Derived context health; not an approval or registry status. */
export type ContextFreshnessStatus = "fresh" | "warning" | "stale" | "unknown";

export type FreshnessSignalSeverity = "info" | "warning" | "error";

export type FreshnessSignalConfidence = "factual" | "heuristic" | "unavailable";

export type ChangedFileDetectionMode = "off" | "git" | "auto";

export interface ContextObservabilityFilter {
  /** When building graphs, include stale chunks and stale/excluded trace links where applicable. */
  include_stale?: boolean;
  /** Graph edge limit (nodes are the transitive closure of selected edges). */
  limit?: number;
  /** Optional whitelist of graph node `type` strings; invalid values are rejected by the API layer. */
  types?: string[];
  /** For freshness only: compare git status to indexed chunk paths. */
  changed_file_detection?: ChangedFileDetectionMode;

  /**
   * Graph query mode. Omitted infers `anchored` when any anchor is present (`root_type`+`root_id` or one shortcut field); otherwise `snapshot`.
   * `snapshot` ignores anchor fields for predictable overview responses.
   */
  mode?: ContextGraphQueryMode;
  /**
   * Anchored graph root (public vocabulary). Prefer either this pair OR exactly one shortcut (`run_id`, `artifact_path`, `source_path`, `stable_id`, `feature_ref`).
   * When both explicit roots and a shortcut are supplied, resolutions must match or validation fails.
   */
  root_type?: ContextGraphRootType;
  root_id?: string;
  /** Neighbor hops from resolved roots (`anchored` only); bounded server-side. */
  depth?: number;
  /** Allow-list of edge `type` strings (`run_trace`, `path_chunk`, …). */
  edge_types?: string[];
  /** Trace link statuses; primarily filters `run_trace` edges. */
  status?: string[];
  /** Trace relations; applies only to `run_trace` edges. */
  relation?: string[];
  /** Candidate ordering before applying `limit`. */
  ordering?: ContextGraphOrdering;
  /** Shortcut anchors (at most one unless paired with consistent explicit `root_type`/`root_id`). */
  run_id?: string;
  artifact_path?: string;
  source_path?: string;
  stable_id?: string;
  feature_ref?: string;
}

export interface FreshnessSignal {
  code: string;
  severity: FreshnessSignalSeverity;
  confidence: FreshnessSignalConfidence;
  /** e.g. `metadata`, `git`, `tool_log`, `spdd_trace` */
  evidence_type?: string;
  message: string;
  count?: number;
  source_paths?: string[];
}

export interface FreshnessSummary {
  total_signals: number;
  error_count: number;
  warning_count: number;
  info_count: number;
  stale_chunk_count: number;
  stale_registry_count: number;
  duplicate_registry_count: number;
  unresolved_trace_link_count: number;
}

export interface ContextFreshnessReport {
  project_id: string;
  status: ContextFreshnessStatus;
  generated_at: string;
  /** ISO time of latest completed ingestion job, if any */
  last_ingested_at?: string;
  signals: FreshnessSignal[];
  summary: FreshnessSummary;
  warnings: string[];
}

export interface MetricWarning {
  code: string;
  message: string;
}

export interface ContextQualityMetrics {
  project_id: string;
  generated_at: string;
  stale_chunk_count: number;
  stale_id_count: number;
  duplicate_id_count: number;
  unresolved_trace_link_count: number;
  /** 0–1 when at least one run exists; omitted when denominator is zero. */
  trace_coverage_ratio?: number;
  /** 0–1 when links exist; omitted when denominator is zero. */
  unresolved_trace_link_ratio?: number;
  /** 0–1 when chunks exist; omitted when denominator is zero. */
  stale_chunk_ratio?: number;
  /** 0–1 when registry entries exist; omitted when denominator is zero. */
  stale_id_ratio?: number;
  validation_usage_count: number;
  failed_tool_call_count: number;
  /** Runs with `memory_event_id` set, divided by total runs; omitted when no runs. */
  memory_mirror_ratio?: number;
  warnings: MetricWarning[];
}

export interface ContextGraphNode {
  id: string;
  type: string;
  label: string;
  status?: string;
  source_path?: string;
  stable_id?: string;
  metadata?: Record<string, unknown>;
}

export interface ContextGraphEdge {
  id: string;
  type: string;
  from: string;
  to: string;
  status?: string;
  relation?: string;
  metadata?: Record<string, unknown>;
}

export interface ContextGraph {
  project_id: string;
  generated_at: string;
  nodes: ContextGraphNode[];
  edges: ContextGraphEdge[];
  warnings: string[];
}
