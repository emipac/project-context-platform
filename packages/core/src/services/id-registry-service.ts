import type { ExtractedId, IdRegistryEntry, MergeResult, MetadataRepository, ProjectConfig, ValidationReport } from "../index.js";

const ID_PATTERN = /\b(REQ|TASK|ADR|DEC|REQCHG|REV|IMPL|AC|NFR|DP)-([A-Z0-9]+)-([0-9A-Z]+)\b/g;
const LEGACY_ADR_HEADING_PATTERN = /^#{1,6}\s+ADR\s+0*([0-9]+)\b[:\s—-]*(.*)$/i;
const LEGACY_ADR_FILE_PATTERN = /(?:^|\/)0*([0-9]+)-([^/]+)\.md$/i;
const LEGACY_USE_CASE_PATTERN = /\bUC-([0-9]+[A-Z]?)\b/gi;
const LEGACY_PLAN_ITEM_PATTERN = /\b(IQ-[0-9]+[A-Z]?|Q[0-9]+(?:\.[0-9]+)?[A-Z]?|P[0-9]+[A-Z]?)\b/g;

type ExtractorOptions = Pick<ProjectConfig["ids"], "project_domain" | "legacy_patterns">;

export class IdExtractor {
  extractIdsFromMarkdown(text: string, path: string, options: ExtractorOptions = defaultExtractorOptions()): ExtractedId[] {
    const entries: ExtractedId[] = [];
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(ID_PATTERN)) {
        entries.push({
          stable_id: match[0],
          category: match[1] as ExtractedId["category"],
          domain: match[2],
          source_path: path,
          heading: nearestHeading(lines, index),
          line_start: index + 1,
          line_end: index + 1
        });
      }
      if (options.legacy_patterns.adr_headings) {
        const legacyAdr = LEGACY_ADR_HEADING_PATTERN.exec(line);
        if (legacyAdr) entries.push(legacyAdrEntry(path, index + 1, legacyAdr[1], legacyAdr[2], options.project_domain));
      }
      if (options.legacy_patterns.use_cases) {
        for (const match of line.matchAll(LEGACY_USE_CASE_PATTERN)) {
          entries.push(legacyLabelEntry(path, index + 1, match[0], `UC${match[1]}`, options.project_domain, "REQ", lines));
        }
      }
      if (options.legacy_patterns.plan_items) {
        for (const match of line.matchAll(LEGACY_PLAN_ITEM_PATTERN)) {
          entries.push(legacyLabelEntry(path, index + 1, match[0], normalizeLegacySuffix(match[0]), options.project_domain, "TASK", lines));
        }
      }
    }
    if (options.legacy_patterns.adr_filenames) {
      const fileAdr = LEGACY_ADR_FILE_PATTERN.exec(path);
      if (fileAdr && /(^|\/)adr\//i.test(path)) entries.push(legacyAdrEntry(path, 1, fileAdr[1], fileAdr[2], options.project_domain));
    }
    return mergeExtractedEntries(entries);
  }
}

export class IdRegistryService {
  constructor(private readonly repository: MetadataRepository) {}

  async mergeIntoRegistry(project_id: string, entries: ExtractedId[], options: { replaceSourcePaths?: string[] } = {}): Promise<MergeResult> {
    const replaceSourcePaths = new Set(options.replaceSourcePaths ?? entries.map((entry) => entry.source_path));
    const existing = (await this.repository.listRegistryEntries(project_id))
      .filter((entry) => !replaceSourcePaths.has(entry.source_path));
    const now = new Date().toISOString();
    const next = entries.map((entry): IdRegistryEntry => {
      const prior = existing.find((item) => item.stable_id === entry.stable_id && item.source_path === entry.source_path);
      return {
        ...entry,
        project_id,
        aliases: entry.aliases,
        status: "current",
        first_seen_at: prior?.first_seen_at ?? now,
        last_seen_at: now
      };
    });
    const duplicates = findDuplicates([...existing.filter((item) => item.project_id === project_id), ...next]);
    const warnings = duplicates.map((item) => `Duplicate stable ID detected: ${item.stable_id}`);
    await this.repository.saveRegistryEntries(project_id, next);
    return { entries: next, duplicates, warnings };
  }

  async validateIds(project_id: string): Promise<ValidationReport> {
    const entries = await this.repository.listRegistryEntries(project_id);
    const duplicates = findDuplicates(entries);
    return {
      project_id,
      valid: duplicates.length === 0,
      duplicates,
      warnings: duplicates.map((item) => `Duplicate stable ID detected: ${item.stable_id}`)
    };
  }
}

function defaultExtractorOptions(): ExtractorOptions {
  return {
    project_domain: "LOCAL",
    legacy_patterns: {
      adr_headings: true,
      adr_filenames: true,
      use_cases: false,
      plan_items: false
    }
  };
}

function legacyAdrEntry(path: string, line: number, number: string, title: string | undefined, domain: string): ExtractedId {
  const padded = number.padStart(4, "0");
  const aliases = [`ADR ${padded}`, `ADR ${Number(number)}`, `ADR-${padded}`];
  const fileAlias = path.split("/").at(-1)?.replace(/\.md$/i, "");
  if (fileAlias) aliases.push(fileAlias);
  return {
    stable_id: `ADR-${domain}-${padded}`,
    aliases: Array.from(new Set(aliases)),
    category: "ADR",
    domain,
    source_path: path,
    heading: title?.trim() ? `ADR ${padded}: ${title.trim()}` : undefined,
    line_start: line,
    line_end: line
  };
}

function legacyLabelEntry(
  path: string,
  line: number,
  alias: string,
  suffix: string,
  domain: string,
  category: ExtractedId["category"],
  lines: string[]
): ExtractedId {
  return {
    stable_id: `${category}-${domain}-${normalizeLegacySuffix(suffix)}`,
    aliases: [alias],
    category,
    domain,
    source_path: path,
    heading: nearestHeading(lines, line - 1),
    line_start: line,
    line_end: line
  };
}

function normalizeLegacySuffix(value: string): string {
  return value.toUpperCase().replace(/\./g, "D").replace(/[^A-Z0-9]/g, "") || "LOCAL";
}

function mergeExtractedEntries(entries: ExtractedId[]): ExtractedId[] {
  const byKey = new Map<string, ExtractedId>();
  for (const entry of entries) {
    const key = `${entry.stable_id}:${entry.source_path}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, entry);
      continue;
    }
    byKey.set(key, {
      ...current,
      aliases: Array.from(new Set([...(current.aliases ?? []), ...(entry.aliases ?? [])])),
      heading: current.heading ?? entry.heading,
      line_start: Math.min(current.line_start ?? entry.line_start ?? 1, entry.line_start ?? current.line_start ?? 1),
      line_end: Math.max(current.line_end ?? entry.line_end ?? 1, entry.line_end ?? current.line_end ?? 1)
    });
  }
  return Array.from(byKey.values());
}

function nearestHeading(lines: string[], index: number): string | undefined {
  for (let i = index; i >= 0; i -= 1) {
    const match = /^(#+)\s+(.+)$/.exec(lines[i]);
    if (match) return match[2];
  }
  return undefined;
}

function findDuplicates(entries: IdRegistryEntry[]): IdRegistryEntry[] {
  const byId = new Map<string, IdRegistryEntry[]>();
  for (const entry of entries) {
    if (entry.status === "stale") continue;
    const key = `${entry.stable_id}:${entry.source_path}:${entry.line_start ?? ""}`;
    const current = byId.get(entry.stable_id) ?? [];
    if (!current.some((item) => `${item.stable_id}:${item.source_path}:${item.line_start ?? ""}` === key)) {
      current.push(entry);
    }
    byId.set(entry.stable_id, current);
  }
  return Array.from(byId.values())
    .filter((matches) => new Set(matches.map((entry) => entry.source_path)).size > 1)
    .map((matches) => ({ ...matches[0], status: "duplicate", stale_reason: "duplicate" }));
}
