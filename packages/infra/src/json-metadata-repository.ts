import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  CanonicalDocumentChunk,
  IdRegistryEntry,
  IngestionJob,
  MetadataRepository,
  SpddArtifact,
  SpddTraceFilter,
  SpddTraceLink,
  SpddWorkRun
} from "@pcp/core";

interface MetadataFile {
  jobs: IngestionJob[];
  chunks: CanonicalDocumentChunk[];
  registry: IdRegistryEntry[];
  spddArtifacts: SpddArtifact[];
  spddRuns: SpddWorkRun[];
  spddLinks: SpddTraceLink[];
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
    db.spddArtifacts = db.spddArtifacts.filter((artifact) => artifact.project_id !== project_id);
    db.spddRuns = db.spddRuns.filter((run) => run.project_id !== project_id);
    db.spddLinks = db.spddLinks.filter((link) => link.project_id !== project_id);
    this.write(db);
  }

  async saveSpddArtifacts(project_id: string, artifacts: SpddArtifact[]): Promise<void> {
    const db = this.read();
    const keys = new Set(artifacts.map((artifact) => artifact.artifact_id));
    db.spddArtifacts = [...db.spddArtifacts.filter((artifact) => artifact.project_id !== project_id || !keys.has(artifact.artifact_id)), ...artifacts];
    this.write(db);
  }

  async listSpddArtifacts(project_id: string, filter?: SpddTraceFilter): Promise<SpddArtifact[]> {
    let rows = this.read().spddArtifacts.filter((artifact) => artifact.project_id === project_id);
    if (filter?.artifact_type) rows = rows.filter((artifact) => artifact.artifact_type === filter.artifact_type);
    if (filter?.artifact_id) rows = rows.filter((artifact) => artifact.artifact_id === filter.artifact_id);
    if (filter?.artifact_path) rows = rows.filter((artifact) => artifact.source_path === filter.artifact_path);
    if (!filter?.include_stale) rows = rows.filter((artifact) => artifact.status === "current");
    if (filter?.stable_id) rows = rows.filter((artifact) => artifact.stable_ids.includes(filter.stable_id!));
    rows.sort(compareSpddArtifactsNewestFirst);
    const lim = clampSpddLimit(filter?.limit);
    return rows.slice(0, lim);
  }

  async saveSpddWorkRun(run: SpddWorkRun): Promise<void> {
    const db = this.read();
    db.spddRuns = [run, ...db.spddRuns.filter((item) => !(item.project_id === run.project_id && item.run_id === run.run_id))];
    this.write(db);
  }

  async listSpddWorkRuns(project_id: string, filter?: SpddTraceFilter): Promise<SpddWorkRun[]> {
    let rows = this.read().spddRuns.filter((run) => run.project_id === project_id);
    if (filter?.run_id) rows = rows.filter((run) => run.run_id === filter.run_id);
    if (filter?.artifact_id) rows = rows.filter((run) => run.artifact_id === filter.artifact_id);
    if (filter?.artifact_path) rows = rows.filter((run) => run.artifact_path === filter.artifact_path);
    rows.sort((left, right) => right.completed_at.localeCompare(left.completed_at));
    const lim = clampSpddLimit(filter?.limit);
    return rows.slice(0, lim);
  }

  async saveSpddTraceLinks(project_id: string, links: SpddTraceLink[]): Promise<void> {
    const db = this.read();
    const keys = new Set(links.map((link) => link.link_id));
    db.spddLinks = [...db.spddLinks.filter((link) => link.project_id !== project_id || !keys.has(link.link_id)), ...links];
    this.write(db);
  }

  async listSpddTraceLinks(project_id: string, filter?: SpddTraceFilter): Promise<SpddTraceLink[]> {
    let rows = this.read().spddLinks.filter((link) => link.project_id === project_id);
    if (filter?.run_id) rows = rows.filter((link) => link.run_id === filter.run_id);
    if (filter?.target_type && filter?.target_id) {
      rows = rows.filter((link) => link.target_type === filter.target_type && link.target_id === filter.target_id);
    }
    if (!filter?.include_stale) rows = rows.filter((link) => link.status !== "stale");
    if (filter?.stable_id) {
      rows = rows.filter(
        (link) =>
          (link.target_type === "stable_id" && link.target_id === filter.stable_id) ||
          link.stable_id === filter.stable_id
      );
    }
    if (filter?.source_path) {
      rows = rows.filter(
        (link) =>
          (link.target_type === "source_path" && link.target_id === filter.source_path) ||
          link.source_path === filter.source_path
      );
    }
    if (filter?.chunk_id) {
      rows = rows.filter(
        (link) =>
          (link.target_type === "chunk" && link.target_id === filter.chunk_id) ||
          link.chunk_id === filter.chunk_id
      );
    }
    if (filter?.feature_ref) rows = rows.filter((link) => link.target_type === "feature" && link.target_id === filter.feature_ref);
    rows.sort((left, right) => right.created_at.localeCompare(left.created_at));
    const lim = clampSpddLimit(filter?.limit);
    return rows.slice(0, lim);
  }

  private read(): MetadataFile {
    const fullPath = resolve(this.metadataPath);
    if (!existsSync(fullPath)) return { jobs: [], chunks: [], registry: [], spddArtifacts: [], spddRuns: [], spddLinks: [] };
    const parsed = JSON.parse(readFileSync(fullPath, "utf8")) as Partial<MetadataFile>;
    return {
      jobs: parsed.jobs ?? [],
      chunks: parsed.chunks ?? [],
      registry: parsed.registry ?? [],
      spddArtifacts: parsed.spddArtifacts ?? [],
      spddRuns: parsed.spddRuns ?? [],
      spddLinks: parsed.spddLinks ?? []
    };
  }

  private write(value: MetadataFile): void {
    const fullPath = resolve(this.metadataPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, JSON.stringify(value, null, 2));
  }
}

function clampSpddLimit(limit?: number): number {
  const n = limit ?? 100;
  return Math.min(200, Math.max(1, n));
}

function compareSpddArtifactsNewestFirst(left: SpddArtifact, right: SpddArtifact): number {
  const created = right.first_seen_at.localeCompare(left.first_seen_at);
  if (created !== 0) return created;
  const updated = right.last_seen_at.localeCompare(left.last_seen_at);
  if (updated !== 0) return updated;
  return right.source_path.localeCompare(left.source_path);
}
