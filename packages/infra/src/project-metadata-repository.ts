import type {
  CanonicalDocumentChunk,
  IdRegistryEntry,
  IngestionJob,
  MetadataRepository,
  ProjectWorkspaceService,
  SpddArtifact,
  SpddTraceFilter,
  SpddTraceLink,
  SpddWorkRun
} from "@pcp/core";
import { SqliteMetadataRepository } from "./sqlite-metadata-repository.js";

export class ProjectMetadataRepository implements MetadataRepository {
  private readonly repositories = new Map<string, SqliteMetadataRepository>();

  constructor(private readonly workspaces: ProjectWorkspaceService) {}

  async saveJob(job: IngestionJob): Promise<void> {
    await (await this.forProject(job.project_id)).saveJob(job);
  }

  async getJob(project_id: string, job_id: string): Promise<IngestionJob | undefined> {
    return (await this.forProject(project_id)).getJob(project_id, job_id);
  }

  async listRecentJobs(project_id: string): Promise<IngestionJob[]> {
    return (await this.forProject(project_id)).listRecentJobs(project_id);
  }

  async saveChunks(project_id: string, chunks: CanonicalDocumentChunk[]): Promise<void> {
    await (await this.forProject(project_id)).saveChunks(project_id, chunks);
  }

  async listChunks(project_id: string): Promise<CanonicalDocumentChunk[]> {
    return (await this.forProject(project_id)).listChunks(project_id);
  }

  async markStaleChunksForPaths(project_id: string, paths: string[], reason?: string): Promise<void> {
    await (await this.forProject(project_id)).markStaleChunksForPaths(project_id, paths, reason);
  }

  async markStaleDocumentChunksForPaths(project_id: string, paths: string[], reason?: string): Promise<void> {
    await (await this.forProject(project_id)).markStaleDocumentChunksForPaths(project_id, paths, reason);
  }

  async markStaleRegistryEntriesExceptPaths(project_id: string, activePaths: string[], reason?: string): Promise<void> {
    await (await this.forProject(project_id)).markStaleRegistryEntriesExceptPaths(project_id, activePaths, reason);
  }

  async saveRegistryEntries(project_id: string, entries: IdRegistryEntry[]): Promise<void> {
    await (await this.forProject(project_id)).saveRegistryEntries(project_id, entries);
  }

  async listRegistryEntries(project_id: string): Promise<IdRegistryEntry[]> {
    return (await this.forProject(project_id)).listRegistryEntries(project_id);
  }

  async saveSpddArtifacts(project_id: string, artifacts: SpddArtifact[]): Promise<void> {
    await (await this.forProject(project_id)).saveSpddArtifacts(project_id, artifacts);
  }

  async listSpddArtifacts(project_id: string, filter?: SpddTraceFilter): Promise<SpddArtifact[]> {
    return (await this.forProject(project_id)).listSpddArtifacts(project_id, filter);
  }

  async saveSpddWorkRun(run: SpddWorkRun): Promise<void> {
    await (await this.forProject(run.project_id)).saveSpddWorkRun(run);
  }

  async listSpddWorkRuns(project_id: string, filter?: SpddTraceFilter): Promise<SpddWorkRun[]> {
    return (await this.forProject(project_id)).listSpddWorkRuns(project_id, filter);
  }

  async saveSpddTraceLinks(project_id: string, links: SpddTraceLink[]): Promise<void> {
    await (await this.forProject(project_id)).saveSpddTraceLinks(project_id, links);
  }

  async listSpddTraceLinks(project_id: string, filter?: SpddTraceFilter): Promise<SpddTraceLink[]> {
    return (await this.forProject(project_id)).listSpddTraceLinks(project_id, filter);
  }

  async deleteProject(project_id: string): Promise<void> {
    const workspace = await this.workspaces.getWorkspace(project_id);
    const repo = await this.forProject(project_id);
    await repo.deleteProject(project_id);
    this.repositories.delete(workspace.metadataDbPath);
  }

  private async forProject(project_id: string): Promise<SqliteMetadataRepository> {
    const workspace = await this.workspaces.getWorkspace(project_id);
    const path = workspace.metadataDbPath;
    const current = this.repositories.get(path);
    if (current) return current;
    const next = new SqliteMetadataRepository(path);
    this.repositories.set(path, next);
    return next;
  }
}
