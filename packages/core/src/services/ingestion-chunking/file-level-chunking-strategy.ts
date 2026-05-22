import type { IngestDocumentInput } from "../../ports/adapters.js";
import type { IngestionChunkingStrategy, RawIngestDocumentContext } from "./ingestion-chunking-types.js";
import { deterministicChunkId, sha256Utf8 } from "./chunk-id.js";
import {
  buildSourceFileSummary,
  extractTopLevelSymbols,
  inferDocumentTypeFromPath,
  inferSourceLanguage
} from "./source-file-summary.js";

export class FileLevelChunkingStrategy implements IngestionChunkingStrategy {
  supports(path: string): boolean {
    const p = path.toLowerCase();
    return !p.endsWith(".md") && !p.endsWith(".mdx");
  }

  chunk(input: RawIngestDocumentContext): IngestDocumentInput[] {
    const text = input.content.replace(/\r\n/g, "\n");
    if (!text.trim()) return [];
    const stable_ids = input.stable_ids ?? [];
    const line_end = text.split("\n").length;
    const chunk_kind = "file" as const;
    const chunk_id = deterministicChunkId(input.project_id, input.path, chunk_kind, 1, line_end, input.heading, stable_ids);
    const source_hash = sha256Utf8(text);
    const symbols = extractTopLevelSymbols(input.path, text);
    const document_type = inferDocumentTypeFromPath(input.path);
    const language = inferSourceLanguage(input.path);
    const summary = buildSourceFileSummary({
      path: input.path,
      heading: input.heading,
      stable_ids,
      chunk_id,
      chunk_kind,
      line_count: line_end,
      source_hash,
      document_type,
      language,
      symbols
    });
    const content_hash = sha256Utf8(summary);
    return [
      {
        path: input.path,
        content: summary,
        stable_ids,
        heading: input.heading,
        chunk_id,
        chunk_kind,
        chunk_index: 0,
        chunk_total: 1,
        line_start: 1,
        line_end,
        content_hash
      }
    ];
  }
}
