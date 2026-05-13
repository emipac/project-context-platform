import type { ProjectWorkspaceService, ToolCallLogEntry, ToolCallLogger } from "@pcp/core";
import { JsonlToolCallLogger } from "./jsonl-tool-call-logger.js";

export class ProjectToolCallLogger implements ToolCallLogger {
  private readonly loggers = new Map<string, JsonlToolCallLogger>();
  private readonly fallback = new JsonlToolCallLogger();

  constructor(private readonly workspaces: ProjectWorkspaceService) {}

  async append(entry: ToolCallLogEntry): Promise<void> {
    if (!entry.project_id) {
      await this.fallback.append(entry);
      return;
    }
    try {
      await (await this.forProject(entry.project_id)).append(entry);
    } catch {
      await this.fallback.append(entry);
    }
  }

  async list(project_id: string): Promise<ToolCallLogEntry[]> {
    return (await this.forProject(project_id)).list(project_id);
  }

  private async forProject(project_id: string): Promise<JsonlToolCallLogger> {
    const workspace = await this.workspaces.getWorkspace(project_id);
    const path = workspace.toolCallLogPath;
    const current = this.loggers.get(path);
    if (current) return current;
    const next = new JsonlToolCallLogger(path);
    this.loggers.set(path, next);
    return next;
  }
}
