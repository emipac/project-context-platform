import type { IngestDocumentInput } from "../../ports/adapters.js";
import type { ChunkKind, ExtractedId } from "../../domain/types.js";
import type { IngestionChunkingStrategy, RawIngestDocumentContext } from "./ingestion-chunking-types.js";
import { deterministicChunkId, sha256Utf8 } from "./chunk-id.js";

interface SectionRegion {
  bodyStart: number;
  bodyEnd: number;
  /** 1-based line number of ATX heading, 0 for preamble */
  headingLine: number;
  headingText?: string;
}

interface TableSpan {
  headerIdx: number;
  sepIdx: number;
  dataStart: number;
  dataEnd: number;
}

interface DraftChunk {
  kind: Extract<ChunkKind, "markdown_section" | "stable_id_anchor" | "markdown_table_row">;
  lo: number;
  hi: number;
  stable_ids: string[];
  includeSectionHeading: boolean;
  linesOverride?: string[];
}

function looksLikeTableRow(line: string): boolean {
  return line.trim().length > 0 && line.includes("|");
}

function isTableSeparatorLine(line: string): boolean {
  const t = line.trim();
  if (!t.includes("|")) return false;
  if (!/-/.test(t)) return false;
  return /^[\s|:\-+]+$/.test(t);
}

function findTables(lines: string[], lo: number, hi: number): TableSpan[] {
  const out: TableSpan[] = [];
  let i = lo;
  while (i <= hi) {
    if (looksLikeTableRow(lines[i]!) && i + 1 <= hi && isTableSeparatorLine(lines[i + 1]!)) {
      const headerIdx = i;
      const sepIdx = i + 1;
      let j = i + 2;
      while (j <= hi && looksLikeTableRow(lines[j]!)) j += 1;
      const dataEnd = j - 1;
      if (dataEnd >= sepIdx + 1) {
        out.push({ headerIdx, sepIdx, dataStart: sepIdx + 1, dataEnd });
        i = j;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

function idInTableDataRow(tables: TableSpan[], idx: number): TableSpan | null {
  for (const t of tables) {
    if (idx >= t.dataStart && idx <= t.dataEnd) return t;
  }
  return null;
}

function paragraphRange(lines: string[], secLo: number, secHi: number, idx: number): [number, number] {
  let lo = idx;
  while (lo > secLo && lines[lo - 1]!.trim() !== "") lo -= 1;
  let hi = idx;
  while (hi < secHi && lines[hi + 1]!.trim() !== "") hi += 1;
  return [lo, hi];
}

function parseSections(lines: string[]): SectionRegion[] {
  const sections: SectionRegion[] = [];
  const headingIdxs: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^(#{1,6})\s+(.+)$/.test(lines[i]!)) headingIdxs.push(i);
  }
  if (headingIdxs.length === 0) {
    if (lines.length) sections.push({ bodyStart: 0, bodyEnd: lines.length - 1, headingLine: 0, headingText: undefined });
    return sections;
  }
  const first = headingIdxs[0]!;
  if (first > 0) {
    sections.push({ bodyStart: 0, bodyEnd: first - 1, headingLine: 0, headingText: undefined });
  }
  for (let k = 0; k < headingIdxs.length; k += 1) {
    const h = headingIdxs[k]!;
    const bodyStart = h + 1;
    const bodyEnd = k + 1 < headingIdxs.length ? headingIdxs[k + 1]! - 1 : lines.length - 1;
    const m = /^(#{1,6})\s+(.+)$/.exec(lines[h]!);
    sections.push({ bodyStart, bodyEnd, headingLine: h + 1, headingText: m?.[2]?.trim() });
  }
  return sections;
}

function idRelevantToSection(entry: ExtractedId, sec: SectionRegion): boolean {
  const line = entry.line_start ?? 0;
  if (line < 1) return false;
  const idx = line - 1;
  if (sec.headingLine > 0) {
    const hIdx = sec.headingLine - 1;
    if (idx === hIdx) return true;
  }
  return idx >= sec.bodyStart && idx <= sec.bodyEnd;
}

function primaryIdsOnLine(idEntries: ExtractedId[], line1: number, sec: SectionRegion): string[] {
  const out = new Set<string>();
  for (const e of idEntries) {
    if (!idRelevantToSection(e, sec)) continue;
    if (e.line_start === line1) out.add(e.stable_id);
  }
  return Array.from(out);
}

function mergeIntervals(intervals: Array<{ lo: number; hi: number; ids: string[] }>): Array<{ lo: number; hi: number; ids: string[] }> {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const out: Array<{ lo: number; hi: number; ids: string[] }> = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (!last || cur.lo > last.hi + 1) {
      out.push({ lo: cur.lo, hi: cur.hi, ids: [...cur.ids] });
    } else {
      last.hi = Math.max(last.hi, cur.hi);
      last.ids = Array.from(new Set([...last.ids, ...cur.ids]));
    }
  }
  return out;
}

function sectionForLine0(sections: SectionRegion[], line0: number): SectionRegion | undefined {
  for (const s of sections) {
    if (s.headingLine === 0) {
      if (line0 >= s.bodyStart && line0 <= s.bodyEnd) return s;
    } else {
      const h0 = s.headingLine - 1;
      if (line0 >= h0 && line0 <= s.bodyEnd) return s;
    }
  }
  return undefined;
}

export class MarkdownChunkingStrategy implements IngestionChunkingStrategy {
  supports(path: string): boolean {
    const p = path.toLowerCase();
    return p.endsWith(".md") || p.endsWith(".mdx");
  }

  chunk(input: RawIngestDocumentContext): IngestDocumentInput[] {
    const text = input.content.replace(/\r\n/g, "\n");
    if (!text.trim()) return [];

    const lines = text.split("\n");
    const maxPerSection = Math.max(1, input.indexing.max_chunks_per_section);
    const sections = parseSections(lines);
    const drafts: DraftChunk[] = [];

    for (const sec of sections) {
      if (sec.bodyStart > sec.bodyEnd && sec.headingLine === 0) continue;

      const sectionDrafts: DraftChunk[] = [];
      const tables = findTables(lines, sec.bodyStart, sec.bodyEnd);
      const consumedStable = new Set<string>();

      for (const t of tables) {
        for (let idx = t.dataStart; idx <= t.dataEnd; idx += 1) {
          const line1 = idx + 1;
          const rowIds = primaryIdsOnLine(input.idEntries, line1, sec);
          if (!rowIds.length) continue;
          for (const sid of rowIds) consumedStable.add(sid);
          sectionDrafts.push({
            kind: "markdown_table_row",
            lo: t.headerIdx,
            hi: idx,
            stable_ids: rowIds,
            includeSectionHeading: false,
            linesOverride: [lines[t.headerIdx]!, lines[t.sepIdx]!, lines[idx]!]
          });
        }
      }

      const anchorSeeds: Array<{ lo: number; hi: number; ids: string[] }> = [];
      for (const e of input.idEntries) {
        if (!idRelevantToSection(e, sec)) continue;
        if (consumedStable.has(e.stable_id)) continue;
        const idx = (e.line_start ?? 1) - 1;
        if (idInTableDataRow(tables, idx)) continue;
        const hIdx = sec.headingLine > 0 ? sec.headingLine - 1 : -1;
        let lo: number;
        let hi: number;
        if (hIdx >= 0 && idx === hIdx) {
          lo = idx;
          hi = idx;
        } else {
          [lo, hi] = paragraphRange(lines, sec.bodyStart, sec.bodyEnd, idx);
        }
        anchorSeeds.push({ lo, hi, ids: [e.stable_id] });
      }
      for (const m of mergeIntervals(anchorSeeds)) {
        const stable_ids = m.ids.filter((sid) => !consumedStable.has(sid));
        for (const sid of stable_ids) consumedStable.add(sid);
        if (m.lo <= m.hi && stable_ids.length) {
          sectionDrafts.push({
            kind: "stable_id_anchor",
            lo: m.lo,
            hi: m.hi,
            stable_ids,
            includeSectionHeading: false
          });
        }
      }

      const excluded = new Set<number>();
      for (const t of tables) {
        for (let j = t.headerIdx; j <= t.dataEnd; j += 1) excluded.add(j);
      }
      for (const d of sectionDrafts) {
        if (d.kind === "stable_id_anchor" || d.kind === "markdown_table_row") {
          for (let j = d.lo; j <= d.hi; j += 1) excluded.add(j);
        }
      }

      const markdownRuns: Array<{ lo: number; hi: number; ids: string[] }> = [];
      let i = sec.bodyStart;
      while (i <= sec.bodyEnd) {
        while (i <= sec.bodyEnd && excluded.has(i)) i += 1;
        if (i > sec.bodyEnd) break;
        const start = i;
        while (i <= sec.bodyEnd && !excluded.has(i)) i += 1;
        const end = i - 1;
        const idsInRun: string[] = [];
        for (const e of input.idEntries) {
          if (!idRelevantToSection(e, sec)) continue;
          if (consumedStable.has(e.stable_id)) continue;
          const li = (e.line_start ?? 1) - 1;
          if (li >= start && li <= end) idsInRun.push(e.stable_id);
        }
        markdownRuns.push({ lo: start, hi: end, ids: Array.from(new Set(idsInRun)) });
      }

      const splitRuns: Array<{ lo: number; hi: number; ids: string[] }> = [];
      for (const run of markdownRuns) {
        const nLines = run.hi - run.lo + 1;
        if (nLines <= maxPerSection) {
          splitRuns.push(run);
          continue;
        }
        const parts = Math.ceil(nLines / maxPerSection);
        const base = Math.floor(nLines / parts);
        let rem = nLines % parts;
        let cur = run.lo;
        for (let p = 0; p < parts; p += 1) {
          const len = base + (rem > 0 ? 1 : 0);
          if (rem > 0) rem -= 1;
          splitRuns.push({ lo: cur, hi: cur + len - 1, ids: p === 0 ? run.ids : [] });
          cur += len;
        }
      }

      let firstMd = true;
      for (const run of splitRuns) {
        const hasText = lines.slice(run.lo, run.hi + 1).some((l) => l.trim() !== "");
        if (!hasText) continue;
        sectionDrafts.push({
          kind: "markdown_section",
          lo: run.lo,
          hi: run.hi,
          stable_ids: run.ids,
          includeSectionHeading: firstMd && Boolean(sec.headingText)
        });
        firstMd = false;
      }

      drafts.push(...sectionDrafts);
    }

    const ordered = drafts
      .map((d, i) => ({ d, i, line: d.lo, kindRank: d.kind === "markdown_table_row" ? 0 : d.kind === "stable_id_anchor" ? 1 : 2 }))
      .sort((a, b) => a.line - b.line || a.kindRank - b.kindRank || a.i - b.i)
      .map((x) => x.d);

    const total = ordered.length;
    const out: IngestDocumentInput[] = [];

    for (let ci = 0; ci < ordered.length; ci += 1) {
      const d = ordered[ci]!;
      const sec = sectionForLine0(sections, d.lo);
      const sectionHeading = sec?.headingText ?? input.heading;

      let bodyLines = d.linesOverride ?? lines.slice(d.lo, d.hi + 1);
      let line_start = d.lo + 1;
      if (d.kind === "markdown_section" && d.includeSectionHeading && sec && sec.headingLine > 0) {
        const hLine = lines[sec.headingLine - 1];
        if (hLine) {
          bodyLines = [hLine, ...bodyLines];
          line_start = sec.headingLine;
        }
      }
      const content = bodyLines.join("\n");
      const line_end = d.hi + 1;
      const stable_ids = d.stable_ids;
      const chunk_kind = d.kind;

      const chunk_id = deterministicChunkId(input.project_id, input.path, chunk_kind, line_start, line_end, sectionHeading, stable_ids);
      out.push({
        path: input.path,
        content,
        stable_ids,
        heading: sectionHeading,
        chunk_id,
        chunk_kind,
        chunk_index: ci,
        chunk_total: total,
        line_start,
        line_end,
        content_hash: sha256Utf8(content)
      });
    }

    return out;
  }
}
