import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CanonicalDocumentChunk,
  DocumentIndexOptions,
  DocumentIndexResponse,
  DocumentSelector,
  IngestDocumentInput,
  IngestionMode,
  LightRagAdapter,
  LightRagSearchBudget,
  MetadataRepository
} from "@pcp/core";
import {
  applySourceDiversityCap,
  compareRankedManifestChunks,
  ProjectWorkspaceService,
  scoreManifestChunk,
  termsFromQuery
} from "@pcp/core";

function sortChunks(chunks: CanonicalDocumentChunk[]): CanonicalDocumentChunk[] {
  return [...chunks].sort(
    (a, b) =>
      a.source_path.localeCompare(b.source_path) ||
      (a.chunk_index ?? 0) - (b.chunk_index ?? 0) ||
      (a.line_start ?? 0) - (b.line_start ?? 0) ||
      a.chunk_id.localeCompare(b.chunk_id)
  );
}

export class LocalLightRagAdapter implements LightRagAdapter {
  constructor(private readonly workspaces: ProjectWorkspaceService, private readonly repository: MetadataRepository) {}

  async getHealth(): Promise<Record<string, unknown>> {
    return {
      status: "ok",
      engine: "lightrag",
      backend: "local",
      llm_configured: false,
      embedding_configured: false,
      storage_ready: true,
      graph_ready: null,
      migration_available: false
    };
  }

  async getStorageHealth(project_id?: string, deep = true): Promise<Record<string, unknown>> {
    const chunks = project_id ? await this.repository.listChunks(project_id) : [];
    const totalBytes = chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.content ?? "", "utf8"), 0);
    return {
      status: "ok",
      backend: "local",
      deep,
      json_validated: true,
      project_id: project_id ?? null,
      checked_files: 0,
      corrupt_file_count: 0,
      projects: project_id
        ? {
            [project_id]: {
              status: "ok",
              project_id,
              deep,
              json_validated: true,
              checked_files: 0,
              json_file_count: 0,
              total_bytes: totalBytes,
              files: [],
              corrupt_files: [],
              warnings: ["Local adapter stores indexed chunks in platform metadata, not LightRAG JSON files."]
            }
          }
        : {},
      warnings: project_id ? [] : ["Project id is required for local storage health details."]
    };
  }

  async searchDocs(project_id: string, query: string, budget: LightRagSearchBudget = {}): Promise<CanonicalDocumentChunk[]> {
    const limit = Number(budget.limit ?? 10);
    const terms = termsFromQuery(query);
    let chunks = await this.repository.listChunks(project_id);
    chunks = chunks.filter((c) => c.status === "current");
    if (budget.document_types?.length) {
      const allow = new Set(budget.document_types);
      chunks = chunks.filter((c) => allow.has(c.document_type));
    }
    if (budget.chunk_kinds?.length) {
      const allow = new Set(budget.chunk_kinds);
      chunks = chunks.filter((c) => allow.has(c.chunk_kind ?? "file"));
    }
    if (budget.source_path_prefixes?.length) {
      const prefs = budget.source_path_prefixes;
      chunks = chunks.filter((c) => prefs.some((p) => c.source_path.startsWith(p)));
    }
    const scored = chunks
      .map((chunk) => ({ chunk, score: scoreManifestChunk(chunk, terms) }))
      .filter((item) => item.score > 0 || terms.length === 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return compareRankedManifestChunks(a.chunk, b.chunk);
      })
      .map((item) => item.chunk);
    return applySourceDiversityCap(scored, limit);
  }

  async listDocuments(project_id: string, opts: DocumentIndexOptions = {}): Promise<DocumentIndexResponse> {
    const limit = clampDocumentLimit(opts.limit);
    const offset = clampDocumentOffset(opts.offset);
    const status = opts.status ?? "current";
    const orderBy = opts.order_by ?? "updated_at";
    const order = opts.order ?? "desc";
    let chunks = await this.repository.listChunks(project_id);
    if (status !== "all") chunks = chunks.filter((chunk) => chunk.status === status);
    if (opts.chunk_kind) chunks = chunks.filter((chunk) => chunk.chunk_kind === opts.chunk_kind);
    chunks = sortDocumentIndexChunks(chunks, orderBy, order);
    return {
      chunks: chunks.slice(offset, offset + limit),
      total: chunks.length,
      limit,
      offset
    };
  }

  async getSpecContext(project_id: string, spec_id: string, includeNeighbors = false): Promise<CanonicalDocumentChunk[]> {
    const trimmed = spec_id.trim();
    if (!trimmed) return [];
    const chunks = await this.repository.listChunks(project_id);
    const current = chunks.filter((c) => c.status === "current");
    let matches = current.filter((c) => c.stable_ids.includes(trimmed));
    if (!matches.length) {
      matches = current.filter((c) => c.source_path.includes(trimmed));
    }
    matches = sortChunks(matches);
    if (!includeNeighbors || matches.length === 0) return matches;

    const NEIGHBOR_RADIUS = 1;
    const byPath = new Map<string, CanonicalDocumentChunk[]>();
    for (const c of current) {
      const list = byPath.get(c.source_path) ?? [];
      list.push(c);
      byPath.set(c.source_path, list);
    }
    for (const list of byPath.values()) {
      list.sort(
        (a, b) =>
          (a.chunk_index ?? 0) - (b.chunk_index ?? 0) ||
          (a.line_start ?? 0) - (b.line_start ?? 0) ||
          a.chunk_id.localeCompare(b.chunk_id)
      );
    }
    const out = new Map<string, CanonicalDocumentChunk>();
    for (const m of matches) {
      out.set(m.chunk_id, m);
      const list = byPath.get(m.source_path);
      if (!list) continue;
      const idx = list.findIndex((c) => c.chunk_id === m.chunk_id);
      if (idx < 0) continue;
      for (let d = -NEIGHBOR_RADIUS; d <= NEIGHBOR_RADIUS; d += 1) {
        const j = idx + d;
        if (j >= 0 && j < list.length) {
          const neighbor = list[j]!;
          out.set(neighbor.chunk_id, neighbor);
        }
      }
    }
    return sortChunks(Array.from(out.values()));
  }

  async getRelatedCode(project_id: string, featureOrReq: string, budget: LightRagSearchBudget = {}): Promise<CanonicalDocumentChunk[]> {
    const limit = Number(budget.limit ?? 10);
    const merged: LightRagSearchBudget = {
      ...budget,
      document_types: budget.document_types?.length ? budget.document_types : ["code", "test"],
      query_mode: budget.query_mode ?? "naive"
    };
    const rows = await this.searchDocs(project_id, featureOrReq, { ...merged, limit: Math.max(limit * 2, limit) });
    return rows.slice(0, limit);
  }

  async getRequirementSources(project_id: string, requirement_id: string): Promise<CanonicalDocumentChunk[]> {
    return sortChunks(
      (await this.repository.listChunks(project_id)).filter(
        (chunk) => chunk.status === "current" && chunk.stable_ids.includes(requirement_id)
      )
    );
  }

  async getDocument(project_id: string, selector: DocumentSelector): Promise<CanonicalDocumentChunk[]> {
    return sortChunks(
      (await this.repository.listChunks(project_id)).filter((chunk) =>
        selector.chunk_id ? chunk.chunk_id === selector.chunk_id : chunk.source_path === selector.source_path
      )
    );
  }

  async ingestPaths(project_id: string, paths: string[], _mode: IngestionMode, documents: IngestDocumentInput[] = []): Promise<{ indexed: number; warnings: string[] }> {
    const workspace = await this.workspaces.getWorkspace(project_id);
    const now = new Date().toISOString();
    const chunks: CanonicalDocumentChunk[] = [];
    const warnings: string[] = [];
    const byPath = new Map<string, IngestDocumentInput[]>();
    for (const document of documents) {
      const list = byPath.get(document.path) ?? [];
      list.push(document);
      byPath.set(document.path, list);
    }
    if (paths.length) await this.repository.markStaleDocumentChunksForPaths(project_id, paths, "replaced");
    for (const path of paths) {
      const fullPath = resolve(workspace.rootPath, path);
      const docs = byPath.get(path);
      if (!docs?.length) {
        if (!existsSync(fullPath)) warnings.push(`Skipped missing file: ${path}`);
        else warnings.push(`No document payloads for path: ${path}`);
        continue;
      }
      for (const document of docs) {
        const content = document.content;
        const chunk_id = document.chunk_id ?? randomUUID();
        chunks.push({
          project_id,
          chunk_id,
          source_path: path,
          heading: document.heading ?? firstHeading(content),
          stable_ids: document.stable_ids ?? [],
          content,
          document_type: documentType(path),
          domain: "local",
          status: "current",
          created_at: now,
          updated_at: now,
          chunk_kind: document.chunk_kind,
          chunk_index: document.chunk_index,
          chunk_total: document.chunk_total,
          line_start: document.line_start,
          line_end: document.line_end,
          content_hash: document.content_hash
        });
      }
    }
    await this.repository.saveChunks(project_id, chunks);
    return { indexed: chunks.length, warnings };
  }

  async deleteProject(project_id: string): Promise<void> {
    await this.repository.deleteProject(project_id);
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

function clampDocumentLimit(value: number | undefined): number {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(500, Math.max(1, Math.floor(parsed)));
}

function clampDocumentOffset(value: number | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function sortDocumentIndexChunks(chunks: CanonicalDocumentChunk[], orderBy: NonNullable<DocumentIndexOptions["order_by"]>, order: NonNullable<DocumentIndexOptions["order"]>): CanonicalDocumentChunk[] {
  const direction = order === "asc" ? 1 : -1;
  return [...chunks].sort((left, right) => {
    let result: number;
    if (orderBy === "chunk_index") {
      result = (left.chunk_index ?? 0) - (right.chunk_index ?? 0);
    } else {
      result = String(left[orderBy] ?? "").localeCompare(String(right[orderBy] ?? ""), undefined, { numeric: true, sensitivity: "base" });
    }
    if (result === 0) result = left.source_path.localeCompare(right.source_path);
    if (result === 0) result = (left.chunk_index ?? 0) - (right.chunk_index ?? 0);
    if (result === 0) result = left.chunk_id.localeCompare(right.chunk_id);
    return result * direction;
  });
}

function firstHeading(content: string): string | undefined {
  return content.split(/\r?\n/).find((line) => line.startsWith("# "))?.replace(/^#\s+/, "");
}

function documentType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.includes("prd")) return "prd";
  if (lower.includes("srs")) return "srs";
  if (lower.includes("test")) return "test";
  if (/\.(ts|tsx|js|jsx|php|blade\.php)$/.test(lower)) return "code";
  return "doc";
}
