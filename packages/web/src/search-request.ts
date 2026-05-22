export type SearchQueryMode = "" | "naive" | "local" | "hybrid" | "mix" | "global";

export type SearchFilters = {
  limit: number;
  documentTypes: string[];
  chunkKinds: string[];
  sourcePathPrefixes: string;
  queryMode: SearchQueryMode;
  topK: string;
  chunkTopK: string;
  maxTotalTokens: string;
  timeoutMs: string;
  retries: string;
};

export type SearchRequestBody = {
  query: string;
  limit?: number;
  document_types?: string[];
  source_path_prefixes?: string[];
  chunk_kinds?: string[];
  query_mode?: Exclude<SearchQueryMode, "">;
  top_k?: number;
  chunk_top_k?: number;
  max_total_tokens?: number;
  timeout_ms?: number;
  retries?: number;
};

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  limit: 12,
  documentTypes: [],
  chunkKinds: [],
  sourcePathPrefixes: "",
  queryMode: "",
  topK: "",
  chunkTopK: "",
  maxTotalTokens: "",
  timeoutMs: "",
  retries: ""
};

export const SEARCH_DOCUMENT_TYPES = ["prd", "srs", "adr", "doc", "code", "test"] as const;
export const SEARCH_CHUNK_KINDS = ["file", "markdown_section", "stable_id_anchor", "markdown_table_row"] as const;

function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function splitPrefixes(raw: string): string[] | undefined {
  const parts = raw
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

export function buildSearchRequestBody(query: string, filters: SearchFilters): SearchRequestBody {
  const body: SearchRequestBody = {
    query: query.trim(),
    limit: filters.limit
  };
  if (filters.documentTypes.length) body.document_types = [...filters.documentTypes];
  const prefixes = splitPrefixes(filters.sourcePathPrefixes);
  if (prefixes) body.source_path_prefixes = prefixes;
  if (filters.chunkKinds.length) body.chunk_kinds = [...filters.chunkKinds];
  if (filters.queryMode) body.query_mode = filters.queryMode;

  const topK = parseOptionalInt(filters.topK);
  if (topK !== undefined) body.top_k = topK;
  const chunkTopK = parseOptionalInt(filters.chunkTopK);
  if (chunkTopK !== undefined) body.chunk_top_k = chunkTopK;
  const maxTotalTokens = parseOptionalInt(filters.maxTotalTokens);
  if (maxTotalTokens !== undefined) body.max_total_tokens = maxTotalTokens;
  const timeoutMs = parseOptionalInt(filters.timeoutMs);
  if (timeoutMs !== undefined) body.timeout_ms = timeoutMs;
  const retries = parseOptionalInt(filters.retries);
  if (retries !== undefined) body.retries = retries;

  return body;
}
