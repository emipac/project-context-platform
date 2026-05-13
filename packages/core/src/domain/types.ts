export type WorkspaceStatus = "active" | "inactive" | "archived";
export type IngestionMode = "full" | "changed" | "document";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "blocked";
export type IdCategory = "REQ" | "TASK" | "ADR" | "DEC" | "REQCHG" | "REV" | "IMPL" | "AC" | "NFR" | "DP";
export type RegistryEntryStatus = "current" | "stale" | "duplicate";
export type ChunkStatus = "current" | "stale";
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

export interface FeatureContextRequestDTO {
  feature_name: string;
  optional_requirement_ids?: string[];
  optional_task_id?: string;
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
