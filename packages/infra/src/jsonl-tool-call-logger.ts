import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ToolCallLogEntry, ToolCallLogger } from "@pcp/core";

export class JsonlToolCallLogger implements ToolCallLogger {
  constructor(private readonly logPath = process.env.PCP_TOOL_CALL_LOG_PATH ?? ".project-context/tool-calls.jsonl") {}

  async append(entry: ToolCallLogEntry): Promise<void> {
    const fullPath = resolve(this.logPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    appendFileSync(fullPath, `${JSON.stringify(entry)}\n`);
  }

  async list(project_id: string): Promise<ToolCallLogEntry[]> {
    const fullPath = resolve(this.logPath);
    if (!existsSync(fullPath)) return [];
    return readFileSync(fullPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ToolCallLogEntry)
      .filter((entry) => entry.project_id === project_id);
  }
}
