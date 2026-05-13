import type { GraphitiAdapter } from "@pcp/core";
import { PlatformError } from "@pcp/core";
import { JsonHttpClient } from "./http-client.js";

export interface GraphitiHttpAdapterOptions {
  baseUrl?: string;
  timeoutMs?: number;
  healthPath?: string;
}

export class GraphitiHttpAdapter implements GraphitiAdapter {
  private readonly client: JsonHttpClient;
  private readonly healthPath: string;

  constructor(options: GraphitiHttpAdapterOptions = {}) {
    this.client = new JsonHttpClient({
      baseUrl: options.baseUrl ?? process.env.GRAPHITI_BASE_URL ?? "http://127.0.0.1:8091",
      timeoutMs: options.timeoutMs ?? Number(process.env.GRAPHITI_TIMEOUT_MS ?? 5000),
      retries: 1
    });
    this.healthPath = options.healthPath ?? process.env.GRAPHITI_HEALTH_PATH ?? "/health";
  }

  async rememberDecision(project_id: string, payload: Record<string, unknown>): Promise<void> {
    await this.client.post("/v1/memory/decisions", { project_id, ...payload }, project_id);
  }

  async rememberReview(project_id: string, payload: Record<string, unknown>): Promise<void> {
    await this.client.post("/v1/memory/reviews", { project_id, ...payload }, project_id);
  }

  async rememberRequirementChange(project_id: string, payload: Record<string, unknown>): Promise<void> {
    await this.client.post("/v1/memory/requirement-changes", { project_id, ...payload }, project_id);
  }

  async rememberImplementationSummary(project_id: string, payload: Record<string, unknown>): Promise<void> {
    await this.client.post("/v1/memory/implementation-summaries", { project_id, ...payload }, project_id);
  }

  async rememberApproval(project_id: string, payload: Record<string, unknown>): Promise<void> {
    await this.client.post("/v1/approvals", { project_id, ...payload }, project_id);
  }

  async getCurrentFacts(project_id: string, topic: string, related_requirement_id?: string): Promise<Record<string, unknown>[]> {
    const response = await this.client.post<{ facts: Record<string, unknown>[] }>("/v1/facts/current", { project_id, topic, related_requirement_id }, project_id);
    return response.facts ?? [];
  }

  async getHistory(project_id: string, topic: string, include_deprecated = false): Promise<Record<string, unknown>[]> {
    const response = await this.client.post<{ events: Record<string, unknown>[] }>("/v1/history", { project_id, topic, include_deprecated }, project_id);
    return response.events ?? [];
  }

  async deleteProject(project_id: string): Promise<void> {
    const trimmed = project_id.trim();
    if (!trimmed) throw new PlatformError("VALIDATION_ERROR", "project_id is required.", { project_id: null });
    await this.client.delete<{ ok: boolean; project_id: string; deleted_events?: boolean; deleted_graph?: boolean }>(
      `/v1/projects/${encodeURIComponent(trimmed)}`,
      trimmed
    );
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
