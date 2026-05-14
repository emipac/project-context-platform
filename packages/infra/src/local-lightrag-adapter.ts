import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { CanonicalDocumentChunk, DocumentSelector, IngestDocumentInput, IngestionMode, LightRagAdapter, MetadataRepository } from "@pcp/core";
import { ProjectWorkspaceService } from "@pcp/core";

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

  async searchDocs(project_id: string, query: string, opts: Record<string, unknown> = {}): Promise<CanonicalDocumentChunk[]> {
    const limit = Number(opts.limit ?? 10);
    const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
    return (await this.repository.listChunks(project_id))
      .filter((chunk) => chunk.status === "current")
      .map((chunk) => ({ chunk, score: terms.filter((term) => chunk.content.toLowerCase().includes(term)).length }))
      .filter((item) => item.score > 0 || terms.length === 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.chunk);
  }

  async getSpecContext(project_id: string, spec_id: string, includeNeighbors = false): Promise<CanonicalDocumentChunk[]> {
    const chunks = await this.repository.listChunks(project_id);
    const matches = chunks.filter((chunk) => chunk.stable_ids.includes(spec_id) || chunk.source_path.includes(spec_id));
    if (!includeNeighbors) return matches;
    const paths = new Set(matches.map((chunk) => chunk.source_path));
    return chunks.filter((chunk) => paths.has(chunk.source_path));
  }

  async getRelatedCode(project_id: string, featureOrReq: string, opts: Record<string, unknown> = {}): Promise<CanonicalDocumentChunk[]> {
    const limit = Number(opts.limit ?? 10);
    return (await this.searchDocs(project_id, featureOrReq, { limit: limit * 2 }))
      .filter((chunk) => /\.(ts|tsx|js|jsx|php|blade\.php)$/.test(chunk.source_path) || chunk.source_path.includes("test"))
      .slice(0, limit);
  }

  async getRequirementSources(project_id: string, requirement_id: string): Promise<CanonicalDocumentChunk[]> {
    return (await this.repository.listChunks(project_id)).filter((chunk) => chunk.stable_ids.includes(requirement_id));
  }

  async getDocument(project_id: string, selector: DocumentSelector): Promise<CanonicalDocumentChunk[]> {
    return (await this.repository.listChunks(project_id))
      .filter((chunk) => selector.chunk_id ? chunk.chunk_id === selector.chunk_id : chunk.source_path === selector.source_path)
      .sort((left, right) => left.source_path.localeCompare(right.source_path));
  }

  async ingestPaths(project_id: string, paths: string[], _mode: IngestionMode, documents: IngestDocumentInput[] = []): Promise<{ indexed: number; warnings: string[] }> {
    const workspace = await this.workspaces.getWorkspace(project_id);
    const now = new Date().toISOString();
    const chunks: CanonicalDocumentChunk[] = [];
    const warnings: string[] = [];
    const byPath = new Map(documents.map((document) => [document.path, document]));
    for (const path of paths) {
      const fullPath = resolve(workspace.rootPath, path);
      const document = byPath.get(path);
      if (!document && !existsSync(fullPath)) {
        warnings.push(`Skipped missing file: ${path}`);
        continue;
      }
      const content = document?.content ?? readFileSync(fullPath, "utf8");
      chunks.push({
        project_id,
        chunk_id: randomUUID(),
        source_path: path,
        heading: document?.heading ?? firstHeading(content),
        stable_ids: document?.stable_ids ?? Array.from(content.matchAll(/\b[A-Z]+-[A-Z0-9]+-[0-9A-Z]+\b/g)).map((match) => match[0]),
        content,
        document_type: documentType(path),
        domain: "local",
        status: "current",
        created_at: now,
        updated_at: now
      });
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
