import type { CanonicalDocumentChunk, DocumentSelector, IngestDocumentInput, IngestionMode, LightRagAdapter } from "@pcp/core";
import { PlatformError } from "@pcp/core";
import { JsonHttpClient } from "./http-client.js";

export interface LightRagHttpAdapterOptions {
  baseUrl?: string;
  timeoutMs?: number;
  healthPath?: string;
}

export class LightRagHttpAdapter implements LightRagAdapter {
  private readonly client: JsonHttpClient;
  private readonly healthPath: string;

  constructor(options: LightRagHttpAdapterOptions = {}) {
    this.client = new JsonHttpClient({
      baseUrl: options.baseUrl ?? process.env.LIGHTRAG_BASE_URL ?? "http://127.0.0.1:9621",
      timeoutMs: options.timeoutMs ?? Number(process.env.LIGHTRAG_TIMEOUT_MS ?? 5000),
      retries: 1
    });
    this.healthPath = options.healthPath ?? process.env.LIGHTRAG_HEALTH_PATH ?? "/health";
  }

  async searchDocs(project_id: string, query: string, opts: Record<string, unknown> = {}): Promise<CanonicalDocumentChunk[]> {
    const response = await this.client.post<{ chunks: CanonicalDocumentChunk[] }>("/v1/search", { project_id, query, ...opts }, project_id);
    return response.chunks ?? [];
  }

  async getSpecContext(project_id: string, spec_id: string, includeNeighbors = false): Promise<CanonicalDocumentChunk[]> {
    const response = await this.client.post<{ chunks: CanonicalDocumentChunk[] }>("/v1/spec-context", { project_id, spec_id, include_neighbors: includeNeighbors }, project_id);
    return response.chunks ?? [];
  }

  async getRelatedCode(project_id: string, featureOrReq: string, opts: Record<string, unknown> = {}): Promise<CanonicalDocumentChunk[]> {
    const response = await this.client.post<{ chunks: CanonicalDocumentChunk[] }>("/v1/related-code", { project_id, query: featureOrReq, ...opts }, project_id);
    return response.chunks ?? [];
  }

  async getRequirementSources(project_id: string, requirement_id: string): Promise<CanonicalDocumentChunk[]> {
    const response = await this.client.post<{ chunks: CanonicalDocumentChunk[] }>("/v1/requirement-sources", { project_id, requirement_id }, project_id);
    return response.chunks ?? [];
  }

  async getDocument(project_id: string, selector: DocumentSelector): Promise<CanonicalDocumentChunk[]> {
    const response = await this.client.post<{ chunks: CanonicalDocumentChunk[] }>("/v1/document", { project_id, ...selector }, project_id);
    return response.chunks ?? [];
  }

  async ingestPaths(project_id: string, paths: string[], mode: IngestionMode, documents: IngestDocumentInput[] = []): Promise<{ indexed: number; warnings: string[] }> {
    return this.client.post<{ indexed: number; warnings: string[] }>("/v1/ingest", { project_id, paths, mode, documents }, project_id);
  }

  async deleteProject(project_id: string): Promise<void> {
    const trimmed = project_id.trim();
    if (!trimmed) throw new PlatformError("VALIDATION_ERROR", "project_id is required.", { project_id: null });
    await this.client.delete<{ ok: boolean; project_id: string; deleted: boolean }>(`/v1/projects/${encodeURIComponent(trimmed)}`, trimmed);
  }

  async ping(project_id?: string): Promise<boolean> {
    try {
      await this.client.get(this.healthPath, project_id);
      return true;
    } catch {
      return false;
    }
  }
}
