import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CanonicalDocumentChunk, IdRegistryEntry, IngestionJob, MetadataRepository } from "@pcp/core";

interface MetadataFile {
  jobs: IngestionJob[];
  chunks: CanonicalDocumentChunk[];
  registry: IdRegistryEntry[];
}

export class JsonMetadataRepository implements MetadataRepository {
  constructor(private readonly metadataPath = ".project-context/metadata.json") {}

  async saveJob(job: IngestionJob): Promise<void> {
    const db = this.read();
    db.jobs = [job, ...db.jobs.filter((item) => item.job_id !== job.job_id)].slice(0, 100);
    this.write(db);
  }

  async getJob(project_id: string, job_id: string): Promise<IngestionJob | undefined> {
    return this.read().jobs.find((job) => job.project_id === project_id && job.job_id === job_id);
  }

  async listRecentJobs(project_id: string): Promise<IngestionJob[]> {
    return this.read().jobs.filter((job) => job.project_id === project_id).slice(0, 50);
  }

  async saveChunks(project_id: string, chunks: CanonicalDocumentChunk[]): Promise<void> {
    const db = this.read();
    const keys = new Set(chunks.map((chunk) => chunk.chunk_id));
    db.chunks = [...db.chunks.filter((chunk) => chunk.project_id !== project_id || !keys.has(chunk.chunk_id)), ...chunks];
    this.write(db);
  }

  async listChunks(project_id: string): Promise<CanonicalDocumentChunk[]> {
    return this.read().chunks.filter((chunk) => chunk.project_id === project_id);
  }

  async markStaleChunksForPaths(project_id: string, paths: string[], reason = "deleted"): Promise<void> {
    const db = this.read();
    db.chunks = db.chunks.map((chunk) => chunk.project_id === project_id && paths.includes(chunk.source_path)
      ? { ...chunk, status: "stale", stale_reason: reason }
      : chunk);
    db.registry = db.registry.map((entry) => entry.project_id === project_id && paths.includes(entry.source_path)
      ? { ...entry, status: "stale", stale_reason: reason as IdRegistryEntry["stale_reason"] }
      : entry);
    this.write(db);
  }

  async markStaleRegistryEntriesExceptPaths(project_id: string, activePaths: string[], reason = "moved"): Promise<void> {
    const db = this.read();
    const active = new Set(activePaths);
    db.registry = db.registry.map((entry) => entry.project_id === project_id && !active.has(entry.source_path)
      ? { ...entry, status: "stale", stale_reason: reason as IdRegistryEntry["stale_reason"] }
      : entry);
    this.write(db);
  }

  async saveRegistryEntries(project_id: string, entries: IdRegistryEntry[]): Promise<void> {
    const db = this.read();
    const keys = new Set(entries.map((entry) => `${entry.stable_id}:${entry.source_path}:${entry.line_start ?? ""}`));
    db.registry = [
      ...db.registry.filter((entry) => entry.project_id !== project_id || !keys.has(`${entry.stable_id}:${entry.source_path}:${entry.line_start ?? ""}`)),
      ...entries
    ];
    this.write(db);
  }

  async listRegistryEntries(project_id: string): Promise<IdRegistryEntry[]> {
    return this.read().registry.filter((entry) => entry.project_id === project_id);
  }

  async deleteProject(project_id: string): Promise<void> {
    const db = this.read();
    db.jobs = db.jobs.filter((job) => job.project_id !== project_id);
    db.chunks = db.chunks.filter((chunk) => chunk.project_id !== project_id);
    db.registry = db.registry.filter((entry) => entry.project_id !== project_id);
    this.write(db);
  }

  private read(): MetadataFile {
    const fullPath = resolve(this.metadataPath);
    if (!existsSync(fullPath)) return { jobs: [], chunks: [], registry: [] };
    return JSON.parse(readFileSync(fullPath, "utf8")) as MetadataFile;
  }

  private write(value: MetadataFile): void {
    const fullPath = resolve(this.metadataPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, JSON.stringify(value, null, 2));
  }
}
