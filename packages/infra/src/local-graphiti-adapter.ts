import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { GraphitiAdapter } from "@pcp/core";

interface MemoryFile {
  events: Array<Record<string, unknown> & { project_id: string; type: string; created_at: string }>;
}

export class LocalGraphitiAdapter implements GraphitiAdapter {
  constructor(private readonly memoryPath = ".project-context/memory.json") {}

  async rememberDecision(project_id: string, payload: Record<string, unknown>): Promise<void> {
    this.append(project_id, "decision", payload);
  }

  async rememberReview(project_id: string, payload: Record<string, unknown>): Promise<void> {
    this.append(project_id, "review_finding", payload);
  }

  async rememberRequirementChange(project_id: string, payload: Record<string, unknown>): Promise<void> {
    this.append(project_id, "requirement_change", payload);
  }

  async rememberImplementationSummary(project_id: string, payload: Record<string, unknown>): Promise<void> {
    this.append(project_id, "implementation_summary", payload);
  }

  async rememberApproval(project_id: string, payload: Record<string, unknown>): Promise<void> {
    this.append(project_id, "approval", payload);
  }

  async getCurrentFacts(project_id: string, topic: string): Promise<Record<string, unknown>[]> {
    return this.read().events.filter((event) => event.project_id === project_id && String(event.topic ?? "").includes(topic) && event.status !== "deprecated");
  }

  async getHistory(project_id: string, topic: string, include_deprecated = false): Promise<Record<string, unknown>[]> {
    return this.read().events.filter((event) => event.project_id === project_id && String(event.topic ?? "").includes(topic) && (include_deprecated || event.status !== "deprecated"));
  }

  async deleteProject(project_id: string): Promise<void> {
    const db = this.read();
    db.events = db.events.filter((event) => event.project_id !== project_id);
    this.write(db);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  private append(project_id: string, type: string, payload: Record<string, unknown>): void {
    const db = this.read();
    db.events.push({ ...payload, project_id, type, created_at: new Date().toISOString() });
    this.write(db);
  }

  private read(): MemoryFile {
    const fullPath = resolve(this.memoryPath);
    if (!existsSync(fullPath)) return { events: [] };
    return JSON.parse(readFileSync(fullPath, "utf8")) as MemoryFile;
  }

  private write(value: MemoryFile): void {
    const fullPath = resolve(this.memoryPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, JSON.stringify(value, null, 2));
  }
}
