import type { CanonicalDocumentChunk } from "../domain/types.js";

export const DEFAULT_MAX_CHUNKS_PER_SOURCE_PATH = 2;

export const STOP_PATH_TOKENS = new Set([
  "src",
  "packages",
  "services",
  "index",
  "test",
  "spec",
  "lib",
  "dist",
  "node_modules"
]);

export type ManifestSearchChunk = Pick<
  CanonicalDocumentChunk,
  "source_path" | "heading" | "stable_ids" | "content" | "chunk_index" | "line_start" | "chunk_id"
>;

export function termsFromQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter(Boolean);
}

export function manifestSearchHaystack(chunk: ManifestSearchChunk): string {
  const heading = chunk.heading ?? "";
  const stableIds = chunk.stable_ids.join(" ");
  return `${chunk.source_path}\n${heading}\n${stableIds}\n${chunk.content}`.toLowerCase();
}

export function scoreManifestChunk(chunk: ManifestSearchChunk, terms: string[]): number {
  if (!terms.length) return 0;
  const haystack = manifestSearchHaystack(chunk);
  const pathLower = chunk.source_path.toLowerCase();
  const headingLower = (chunk.heading ?? "").toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    total += 1;
    if (pathLower.includes(term)) total += 1;
    if (headingLower.includes(term)) total += 1;
  }
  return total;
}

export function compareRankedManifestChunks(a: ManifestSearchChunk, b: ManifestSearchChunk): number {
  const pathCmp = a.source_path.localeCompare(b.source_path);
  if (pathCmp !== 0) return pathCmp;
  const indexCmp = (a.chunk_index ?? 0) - (b.chunk_index ?? 0);
  if (indexCmp !== 0) return indexCmp;
  const lineCmp = (a.line_start ?? 0) - (b.line_start ?? 0);
  if (lineCmp !== 0) return lineCmp;
  return a.chunk_id.localeCompare(b.chunk_id);
}

export function applySourceDiversityCap<T extends { source_path: string }>(
  ranked: T[],
  limit: number,
  maxPerSourcePath = DEFAULT_MAX_CHUNKS_PER_SOURCE_PATH
): T[] {
  if (limit <= 0) return [];
  const firstPass: T[] = [];
  const picked = new Set<number>();
  const counts = new Map<string, number>();

  for (let i = 0; i < ranked.length && firstPass.length < limit; i += 1) {
    const item = ranked[i]!;
    const seen = counts.get(item.source_path) ?? 0;
    if (seen >= maxPerSourcePath) continue;
    counts.set(item.source_path, seen + 1);
    firstPass.push(item);
    picked.add(i);
  }

  if (firstPass.length >= limit) return firstPass;

  const out = [...firstPass];
  for (let i = 0; i < ranked.length && out.length < limit; i += 1) {
    if (picked.has(i)) continue;
    out.push(ranked[i]!);
    picked.add(i);
  }
  return out;
}
