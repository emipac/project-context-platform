import type {
  CanonicalDocumentChunk,
  ChunkKind,
  ChunkStatus,
  IdRegistryEntry,
  IngestionMode,
  SpddArtifact,
  SpddTraceFilter,
  SpddTraceLink,
  SpddWorkRun,
  ToolCallLogEntry
} from "../domain/types.js";

export interface IngestDocumentInput {
  path: string;
  content: string;
  stable_ids?: string[];
  heading?: string;
  chunk_id?: string;
  chunk_kind?: ChunkKind;
  chunk_index?: number;
  chunk_total?: number;
  line_start?: number;
  line_end?: number;
  content_hash?: string;
}

export interface DocumentSelector {
  chunk_id?: string;
  source_path?: string;
}

export type DocumentIndexStatus = ChunkStatus | "all";
export type DocumentIndexOrderBy = "updated_at" | "created_at" | "source_path" | "chunk_index";
export type DocumentIndexOrder = "asc" | "desc";

export interface DocumentIndexOptions {
  limit?: number;
  offset?: number;
  status?: DocumentIndexStatus;
  chunk_kind?: ChunkKind;
  order_by?: DocumentIndexOrderBy;
  order?: DocumentIndexOrder;
}

export interface DocumentIndexResponse {
  chunks: CanonicalDocumentChunk[];
  total: number;
  limit: number;
  offset: number;
}

/** Per-call LightRAG search / related-code budgets and scope hints (all fields optional for backward compatibility). */
export type LightRagSearchBudget = {
  limit?: number;
  document_types?: string[];
  source_path_prefixes?: string[];
  chunk_kinds?: string[];
  query_mode?: "naive" | "local" | "hybrid" | "mix" | "global";
  top_k?: number;
  chunk_top_k?: number;
  max_total_tokens?: number;
  timeout_ms?: number;
  retries?: number;
};

export interface LightRagAdapter {
  getHealth(project_id?: string): Promise<Record<string, unknown>>;
  getStorageHealth(project_id?: string, deep?: boolean): Promise<Record<string, unknown>>;
  listDocuments(project_id: string, opts?: DocumentIndexOptions): Promise<DocumentIndexResponse>;
  searchDocs(project_id: string, query: string, budget?: LightRagSearchBudget): Promise<CanonicalDocumentChunk[]>;
  getSpecContext(project_id: string, spec_id: string, includeNeighbors?: boolean): Promise<CanonicalDocumentChunk[]>;
  getRelatedCode(project_id: string, featureOrReq: string, budget?: LightRagSearchBudget): Promise<CanonicalDocumentChunk[]>;
  getRequirementSources(project_id: string, requirement_id: string): Promise<CanonicalDocumentChunk[]>;
  getDocument(project_id: string, selector: DocumentSelector): Promise<CanonicalDocumentChunk[]>;
  ingestPaths(project_id: string, paths: string[], mode: IngestionMode, documents?: IngestDocumentInput[]): Promise<{ indexed: number; warnings: string[] }>;
  deleteProject(project_id: string): Promise<void>;
  ping(project_id?: string): Promise<boolean>;
}

export interface GraphitiAdapter {
  getHealth(project_id?: string): Promise<Record<string, unknown>>;
  rememberDecision(project_id: string, payload: Record<string, unknown>): Promise<void>;
  rememberReview(project_id: string, payload: Record<string, unknown>): Promise<void>;
  rememberRequirementChange(project_id: string, payload: Record<string, unknown>): Promise<void>;
  rememberImplementationSummary(project_id: string, payload: Record<string, unknown>): Promise<void>;
  rememberApproval(project_id: string, payload: Record<string, unknown>): Promise<void>;
  getCurrentFacts(project_id: string, topic: string, related_requirement_id?: string): Promise<Record<string, unknown>[]>;
  getHistory(project_id: string, topic: string, include_deprecated?: boolean): Promise<Record<string, unknown>[]>;
  deleteProject(project_id: string): Promise<void>;
  ping(project_id?: string): Promise<boolean>;
}

export interface ToolCallLogger {
  append(entry: ToolCallLogEntry): Promise<void>;
  list(project_id: string): Promise<ToolCallLogEntry[]>;
}

export interface MetadataRepository {
  saveJob(job: import("../domain/types.js").IngestionJob): Promise<void>;
  getJob(project_id: string, job_id: string): Promise<import("../domain/types.js").IngestionJob | undefined>;
  listRecentJobs(project_id: string): Promise<import("../domain/types.js").IngestionJob[]>;
  saveChunks(project_id: string, chunks: CanonicalDocumentChunk[]): Promise<void>;
  listChunks(project_id: string): Promise<CanonicalDocumentChunk[]>;
  markStaleChunksForPaths(project_id: string, paths: string[], reason?: string): Promise<void>;
  /** Marks document chunks stale without touching ID registry (safe for same-path re-ingest). */
  markStaleDocumentChunksForPaths(project_id: string, paths: string[], reason?: string): Promise<void>;
  markStaleRegistryEntriesExceptPaths?(project_id: string, activePaths: string[], reason?: string): Promise<void>;
  saveRegistryEntries(project_id: string, entries: IdRegistryEntry[]): Promise<void>;
  listRegistryEntries(project_id: string): Promise<IdRegistryEntry[]>;
  saveSpddArtifacts(project_id: string, artifacts: SpddArtifact[]): Promise<void>;
  listSpddArtifacts(project_id: string, filter?: SpddTraceFilter): Promise<SpddArtifact[]>;
  saveSpddWorkRun(run: SpddWorkRun): Promise<void>;
  listSpddWorkRuns(project_id: string, filter?: SpddTraceFilter): Promise<SpddWorkRun[]>;
  saveSpddTraceLinks(project_id: string, links: SpddTraceLink[]): Promise<void>;
  listSpddTraceLinks(project_id: string, filter?: SpddTraceFilter): Promise<SpddTraceLink[]>;
  deleteProject(project_id: string): Promise<void>;
}
