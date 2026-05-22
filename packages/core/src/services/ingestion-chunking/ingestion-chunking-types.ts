import type { IngestDocumentInput } from "../../ports/adapters.js";
import type { ExtractedId, IndexingConfig } from "../../domain/types.js";

export interface RawIngestDocumentContext {
  project_id: string;
  path: string;
  content: string;
  idEntries: ExtractedId[];
  heading?: string;
  stable_ids: string[];
  indexing: IndexingConfig;
}

export interface IngestionChunkingStrategy {
  supports(path: string): boolean;
  chunk(input: RawIngestDocumentContext): IngestDocumentInput[];
}
