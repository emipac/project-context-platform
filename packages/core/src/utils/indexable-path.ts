import type { ProjectConfig } from "../domain/types.js";

/** Mirrors ingestion indexing rules for observability helpers (changed-file hints). */
export function isProjectIndexablePath(path: string, config: ProjectConfig): boolean {
  if (!/\.(md|mdx|ts|tsx|js|jsx|php|blade\.php|json|yml|yaml|html|css|xml|txt|dbml)$/.test(path)) return false;
  if (config.indexing.ignore.some((pattern) => globMatches(path, pattern))) return false;
  return config.indexing.include.some((pattern) => globMatches(path, pattern));
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function globMatches(path: string, pattern: string): boolean {
  const normalized = normalizePath(pattern).replace(/^["']|["']$/g, "");
  if (!normalized) return false;
  if (!normalized.includes("*")) return path === normalized || path.startsWith(`${normalized.replace(/\/$/, "")}/`);
  const regex = new RegExp(`^${globToRegex(normalized)}$`);
  return regex.test(path);
}

function globToRegex(pattern: string): string {
  let output = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        output += ".*";
        i += 1;
      } else {
        output += "[^/]*";
      }
      continue;
    }
    output += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return output;
}
