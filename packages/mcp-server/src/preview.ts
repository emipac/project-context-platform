import type { CanonicalDocumentChunk } from "@pcp/core";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const PREVIEW_LENGTH = 1000;

export interface PreviewChunk {
  project_id: string;
  chunk_id: string;
  source_path: string;
  heading?: string;
  stable_ids: string[];
  document_type: string;
  domain: string;
  status: string;
  preview: string;
  content_length: number;
  truncated: boolean;
}

export function clampLimit(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

export function withClampedLimit(input: Record<string, unknown>): Record<string, unknown> {
  return { ...input, limit: clampLimit(input.limit) };
}

export function previewChunks(chunks: CanonicalDocumentChunk[]): PreviewChunk[] {
  return chunks.map((chunk) => {
    const preview = chunk.content.slice(0, PREVIEW_LENGTH);
    return {
      project_id: chunk.project_id,
      chunk_id: chunk.chunk_id,
      source_path: chunk.source_path,
      heading: chunk.heading,
      stable_ids: chunk.stable_ids,
      document_type: chunk.document_type,
      domain: chunk.domain,
      status: chunk.status,
      preview,
      content_length: chunk.content.length,
      truncated: chunk.content.length > preview.length
    };
  });
}
