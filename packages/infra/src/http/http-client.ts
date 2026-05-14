import { setTimeout as sleep } from "node:timers/promises";
import { PlatformError } from "@pcp/core";

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs: number;
  retries?: number;
  defaultHeaders?: Record<string, string>;
}

export class JsonHttpClient {
  constructor(private readonly options: HttpClientOptions) {}

  async get<T>(path: string, project_id?: string): Promise<T> {
    return this.request<T>("GET", path, undefined, project_id);
  }

  async post<T>(path: string, body: Record<string, unknown>, project_id?: string): Promise<T> {
    return this.request<T>("POST", path, body, project_id);
  }

  async delete<T>(path: string, project_id?: string): Promise<T> {
    return this.request<T>("DELETE", path, undefined, project_id);
  }

  async request<T>(method: string, path: string, body?: Record<string, unknown>, project_id?: string): Promise<T> {
    const retries = this.options.retries ?? 1;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await fetch(new URL(path, this.options.baseUrl), {
          method,
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "x-project-id": project_id ?? "",
            ...this.options.defaultHeaders
          },
          body: body ? JSON.stringify(body) : undefined
        });
        const text = await response.text();
        const payload = text ? JSON.parse(text) as unknown : {};
        if (!response.ok) {
          throw upstreamError(response.status, payload, project_id);
        }
        return payload as T;
      } catch (err) {
        lastError = err;
        if (err instanceof PlatformError && !err.retryable) throw err;
        if (attempt < retries) await sleep(100 * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
    }
    if (lastError instanceof PlatformError) throw lastError;
    throw new PlatformError("BACKEND_UNAVAILABLE", "External service is unavailable.", {
      project_id: project_id ?? null,
      retryable: true
    });
  }
}

function upstreamError(status: number, payload: unknown, project_id?: string): PlatformError {
  const raw = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const body = raw.detail && typeof raw.detail === "object" ? raw.detail as Record<string, unknown> : raw;
  const code = typeof body.code === "string" ? body.code : status >= 500 ? "BACKEND_UNAVAILABLE" : "VALIDATION_ERROR";
  const message = typeof body.message === "string" ? body.message : "External service request failed.";
  return new PlatformError(code, message, {
    httpStatus: status >= 500 ? 503 : status,
    project_id: typeof body.project_id === "string" ? body.project_id : project_id ?? null,
    details: typeof body.details === "object" && body.details ? body.details as Record<string, unknown> : {},
    retryable: status >= 500 || status === 408 || status === 429
  });
}
