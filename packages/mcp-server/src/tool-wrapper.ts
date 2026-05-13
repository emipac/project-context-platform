import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { PlatformError, type ToolCallLogger } from "@pcp/core";

export function mcpToolWrapper<TInput, TOutput>(
  toolName: string,
  logger: ToolCallLogger,
  handler: (input: TInput) => Promise<TOutput>
): (input: TInput) => Promise<{ ok: true; result: TOutput } | { ok: false; error: ReturnType<PlatformError["toJson"]> }> {
  return async (input: TInput) => {
    const started = performance.now();
    const project_id = typeof input === "object" && input && "project_id" in input ? String((input as Record<string, unknown>).project_id ?? "") || null : null;
    try {
      const result = await handler(input);
      await logger.append({
        project_id,
        call_id: randomUUID(),
        interface: "mcp",
        tool: toolName,
        status: "ok",
        duration_ms: Math.round(performance.now() - started),
        input_summary: summarize(input),
        result_summary: summarize(result),
        created_at: new Date().toISOString()
      });
      return { ok: true, result };
    } catch (err) {
      const mapped = PlatformError.mapUnknown(err);
      await logger.append({
        project_id: mapped.project_id ?? project_id,
        call_id: randomUUID(),
        interface: "mcp",
        tool: toolName,
        status: "error",
        duration_ms: Math.round(performance.now() - started),
        input_summary: summarize(input),
        result_summary: { error_code: mapped.code },
        created_at: new Date().toISOString()
      });
      return { ok: false, error: mapped.toJson() };
    }
  };
}

function summarize(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return { value_type: typeof value };
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, Array.isArray(item) ? { count: item.length } : typeof item]));
}
