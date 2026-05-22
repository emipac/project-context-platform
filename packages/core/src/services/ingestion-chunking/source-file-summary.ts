/** Hard cap on path tokens embedded in source summary cards. */
export const MAX_PATH_TOKENS = 12;

/** Hard cap on extracted symbol names per file chunk. */
export const MAX_SYMBOLS = 16;
/** Truncate long identifiers so summaries stay bounded. */
export const MAX_SYMBOL_LENGTH = 72;

export interface SourceFileSummaryParams {
  path: string;
  heading?: string;
  stable_ids: string[];
  chunk_id: string;
  chunk_kind: string;
  line_count: number;
  source_hash: string;
  document_type: string;
  language: string;
  symbols: string[];
}

/** Mirrors `documentType` in LocalLightRagAdapter for consistent labels. */
export function inferDocumentTypeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.includes("prd")) return "prd";
  if (lower.includes("srs")) return "srs";
  if (lower.includes("test")) return "test";
  if (/\.(ts|tsx|js|jsx|php)$/.test(lower) || lower.endsWith(".blade.php")) return "code";
  return "doc";
}

export function inferSourceLanguage(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return "typescript-react";
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".jsx")) return "javascript-react";
  if (lower.endsWith(".js")) return "javascript";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".xml")) return "xml";
  if (lower.endsWith(".txt")) return "text";
  if (lower.endsWith(".php") || lower.endsWith(".blade.php")) return "php";
  if (lower.endsWith(".dbml")) return "dbml";
  return "unknown";
}

function truncateSymbol(name: string): string {
  const t = name.trim();
  if (!t) return "";
  if (t.length <= MAX_SYMBOL_LENGTH) return t;
  return `${t.slice(0, MAX_SYMBOL_LENGTH)}…`;
}

function pushUnique(out: string[], raw: string): void {
  if (out.length >= MAX_SYMBOLS) return;
  const s = truncateSymbol(raw);
  if (!s || out.includes(s)) return;
  out.push(s);
}

function extractPythonSymbols(content: string, out: string[]): void {
  const defRe = /^\s*(?:async\s+)?def\s+([a-zA-Z_]\w*)\s*\(/gm;
  const classRe = /^\s*class\s+([a-zA-Z_]\w*)\b/gm;
  let m: RegExpExecArray | null;
  while ((m = defRe.exec(content)) !== null) pushUnique(out, m[1]!);
  while ((m = classRe.exec(content)) !== null) pushUnique(out, m[1]!);
}

function extractTsJsSymbols(content: string, out: string[]): void {
  const patterns: RegExp[] = [
    /^\s*export\s+default\s+function\s+([$A-Za-z_][$\w]*)/gm,
    /^\s*export\s+(?:async\s+)?function\s+([$A-Za-z_][$\w]*)/gm,
    /^\s*export\s+class\s+([$A-Za-z_][$\w]*)/gm,
    /^\s*export\s+(?:abstract\s+)?(?:interface|type|enum)\s+([$A-Za-z_][$\w]*)/gm,
    /^\s*export\s+const\s+([$A-Za-z_][$\w]*)/gm,
    /^\s*(?:async\s+)?function\s+([$A-Za-z_][$\w]*)\s*\(/gm,
    /^\s*class\s+([$A-Za-z_][$\w]*)\s*[<{]/gm,
    /^\s*(?:interface|type|enum)\s+([$A-Za-z_][$\w]*)\s*[<{=/]/gm,
    /^\s*const\s+([$A-Za-z_][$\w]*)\s*=/gm
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      pushUnique(out, m[1]!.trim());
      if (out.length >= MAX_SYMBOLS) return;
    }
  }
}

/**
 * Best-effort top-level symbol names for discovery. Regex-only; false negatives are acceptable.
 */
export function extractTopLevelSymbols(path: string, content: string): string[] {
  const lower = path.toLowerCase();
  const out: string[] = [];
  if (/\.(tsx?|jsx?)$/.test(lower)) extractTsJsSymbols(content, out);
  else if (lower.endsWith(".py")) extractPythonSymbols(content, out);
  return out.slice(0, MAX_SYMBOLS);
}

function csv(ids: string[]): string {
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  return sorted.length ? sorted.join(", ") : "(none)";
}

const PATH_TOKEN_STOP = new Set(["src", "packages", "services", "index", "test", "spec", "lib", "dist", "node_modules"]);

function pushPathToken(out: string[], raw: string): void {
  const t = raw.trim().toLowerCase();
  if (!t || t.length < 2 || PATH_TOKEN_STOP.has(t) || out.includes(t)) return;
  out.push(t);
}

function splitCamelCaseToken(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean);
}

export function derivePathTokens(path: string): string[] {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    const base = segment.includes(".") ? segment.slice(0, segment.lastIndexOf(".")) : segment;
    for (const part of base.split(/[-_.]+/)) {
      for (const piece of splitCamelCaseToken(part)) {
        pushPathToken(out, piece);
      }
    }
  }
  return out.slice(0, MAX_PATH_TOKENS);
}

export function derivePrimarySymbol(path: string, symbols: string[]): string | undefined {
  if (symbols.length) return symbols[0];
  const base = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  if (!base) return undefined;
  const parts = base.split(/[-_]+/).filter(Boolean);
  if (!parts.length) return undefined;
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join("");
}

/**
 * Deterministic plain-text chunk body for non-Markdown files (discovery record, not full source).
 */
export function buildSourceFileSummary(params: SourceFileSummaryParams): string {
  const basename = params.path.split("/").pop() ?? params.path;
  const pathTokens = derivePathTokens(params.path);
  const primarySymbol = derivePrimarySymbol(params.path, params.symbols);
  const lines = [
    `path: ${params.path}`,
    `basename: ${basename}`,
    ...(pathTokens.length ? [`path_tokens: ${pathTokens.join(", ")}`] : []),
    `document_type: ${params.document_type}`,
    `language: ${params.language}`,
    `chunk_kind: ${params.chunk_kind}`,
    `chunk_id: ${params.chunk_id}`,
    `line_count: ${params.line_count}`,
    `source_hash: ${params.source_hash}`,
    ...(primarySymbol ? [`primary_symbol: ${primarySymbol}`] : []),
    `stable_ids: ${csv(params.stable_ids)}`,
    `symbols: ${params.symbols.length ? params.symbols.join(", ") : "(none)"}`
  ];
  if (params.heading?.trim()) {
    const insertAt = lines.findIndex((line) => line.startsWith("source_hash:"));
    lines.splice(insertAt >= 0 ? insertAt : lines.length - 2, 0, `heading: ${params.heading.trim()}`);
  }
  return lines.join("\n");
}
