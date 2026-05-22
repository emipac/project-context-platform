import type {
  CanonicalDocumentChunk,
  DocumentIndexOptions,
  DocumentIndexResponse,
  DocumentSelector,
  IngestDocumentInput,
  IngestionMode,
  LightRagAdapter,
  LightRagSearchBudget
} from "@pcp/core";
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
      timeoutMs: options.timeoutMs ?? Number(process.env.LIGHTRAG_TIMEOUT_MS ?? 60000),
      retries: 1
    });
    this.healthPath = options.healthPath ?? process.env.LIGHTRAG_HEALTH_PATH ?? "/health";
  }

  async getHealth(project_id?: string): Promise<Record<string, unknown>> {
    const path = project_id ? `${this.healthPath}?project_id=${encodeURIComponent(project_id)}` : this.healthPath;
    return this.client.get<Record<string, unknown>>(path, project_id);
  }

  async getStorageHealth(project_id?: string, deep = true): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    if (project_id) params.set("project_id", project_id);
    params.set("deep", String(deep));
    return this.client.get<Record<string, unknown>>(`/v1/storage/health?${params.toString()}`, project_id);
  }

  async searchDocs(project_id: string, query: string, budget: LightRagSearchBudget = {}): Promise<CanonicalDocumentChunk[]> {
    const body = searchBody(project_id, query, budget);
    const response = await this.client.post<{ chunks: CanonicalDocumentChunk[] }>("/v1/search", body, project_id, perCallFromBudget(budget));
    return response.chunks ?? [];
  }

  async listDocuments(project_id: string, opts: DocumentIndexOptions = {}): Promise<DocumentIndexResponse> {
    return this.client.post<DocumentIndexResponse>("/v1/documents", { project_id, ...opts }, project_id);
  }

  async getSpecContext(project_id: string, spec_id: string, includeNeighbors = false): Promise<CanonicalDocumentChunk[]> {
    const response = await this.client.post<{ chunks: CanonicalDocumentChunk[] }>("/v1/spec-context", { project_id, spec_id, include_neighbors: includeNeighbors }, project_id);
    return response.chunks ?? [];
  }

  async getRelatedCode(project_id: string, featureOrReq: string, budget: LightRagSearchBudget = {}): Promise<CanonicalDocumentChunk[]> {
    const body = relatedCodeBody(project_id, featureOrReq, budget);
    const response = await this.client.post<{ chunks: CanonicalDocumentChunk[] }>("/v1/related-code", body, project_id, perCallFromBudget(budget));
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
      await this.getHealth(project_id);
      return true;
    } catch {
      return false;
    }
  }
}

function perCallFromBudget(budget: LightRagSearchBudget): { timeoutMs?: number; retries?: number } {
  const out: { timeoutMs?: number; retries?: number } = {};
  if (budget.timeout_ms !== undefined) out.timeoutMs = budget.timeout_ms;
  if (budget.retries !== undefined) out.retries = budget.retries;
  return out;
}

function searchBody(project_id: string, query: string, budget: LightRagSearchBudget): Record<string, unknown> {
  const { retries: _retries, ...rest } = budget;
  const body: Record<string, unknown> = { project_id, query };
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) body[key] = value;
  }
  return body;
}

function relatedCodeBody(project_id: string, query: string, budget: LightRagSearchBudget): Record<string, unknown> {
  const { retries: _retries, ...rest } = budget;
  const body: Record<string, unknown> = { project_id, query };
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) body[key] = value;
  }
  return body;
}
