import type {
  CanonicalDocumentChunk,
  IdRegistryEntry,
  IngestionMode,
  ToolCallLogEntry
} from "../domain/types.js";

export interface IngestDocumentInput {
  path: string;
  content: string;
  stable_ids?: string[];
  heading?: string;
}

export interface DocumentSelector {
  chunk_id?: string;
  source_path?: string;
}

export interface LightRagAdapter {
  getHealth(project_id?: string): Promise<Record<string, unknown>>;
  searchDocs(project_id: string, query: string, opts?: Record<string, unknown>): Promise<CanonicalDocumentChunk[]>;
  getSpecContext(project_id: string, spec_id: string, includeNeighbors?: boolean): Promise<CanonicalDocumentChunk[]>;
  getRelatedCode(project_id: string, featureOrReq: string, opts?: Record<string, unknown>): Promise<CanonicalDocumentChunk[]>;
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
  markStaleRegistryEntriesExceptPaths?(project_id: string, activePaths: string[], reason?: string): Promise<void>;
  saveRegistryEntries(project_id: string, entries: IdRegistryEntry[]): Promise<void>;
  listRegistryEntries(project_id: string): Promise<IdRegistryEntry[]>;
  deleteProject(project_id: string): Promise<void>;
}
