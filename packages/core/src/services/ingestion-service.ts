import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadProjectConfig, type IngestDocumentInput, type IngestionJob, type LightRagAdapter, type MetadataRepository, type ProjectConfig } from "../index.js";
import { PlatformError } from "../errors/platform-error.js";
import { IdExtractor, IdRegistryService } from "./id-registry-service.js";
import { ProjectWorkspaceService } from "./project-workspace-service.js";

export class IngestionService {
  private readonly extractor = new IdExtractor();
  private readonly ids: IdRegistryService;

  constructor(
    private readonly workspaces: ProjectWorkspaceService,
    private readonly lightrag: LightRagAdapter,
    private readonly repository: MetadataRepository
  ) {
    this.ids = new IdRegistryService(repository);
  }

  async ingestFull(project_id: string, options: { confirmed?: boolean; requested_by?: string } = {}): Promise<IngestionJob> {
    if (!options.confirmed) {
      throw new PlatformError("INGESTION_CONFLICT", "Full reindex requires explicit human confirmation.", {
        project_id,
        details: { confirmed: false }
      });
    }
    const workspace = await this.workspaces.getWorkspace(project_id);
    const config = loadProjectConfig(workspace.rootPath);
    return this.ingestPaths(project_id, listIndexableFiles(workspace.rootPath, config), "full", options.requested_by ?? "agent", false);
  }

  async ingestChanged(project_id: string, paths?: string[]): Promise<IngestionJob> {
    const workspace = await this.workspaces.getWorkspace(project_id);
    const config = loadProjectConfig(workspace.rootPath);
    const resolved = paths?.length ? paths.filter((path) => isIndexablePath(normalizePath(path), config)) : listIndexableFiles(workspace.rootPath, config);
    return this.ingestPaths(project_id, resolved, "changed", "agent", false);
  }

  async ingestDocument(project_id: string, path: string): Promise<IngestionJob> {
    const workspace = await this.workspaces.getWorkspace(project_id);
    const resolved = resolve(workspace.rootPath, path);
    if (!resolved.startsWith(workspace.rootPath)) {
      throw new PlatformError("VALIDATION_ERROR", "Path must belong to the workspace root.", { project_id, details: { path } });
    }
    const config = loadProjectConfig(workspace.rootPath);
    const relativePath = normalizePath(relative(workspace.rootPath, resolved));
    if (!isIndexablePath(relativePath, config)) {
      throw new PlatformError("VALIDATION_ERROR", "Path is not indexable by project configuration.", {
        project_id,
        details: { path: relativePath }
      });
    }
    return this.ingestPaths(project_id, [relativePath], "document", "agent", false);
  }

  async getIngestionStatus(project_id: string, job_id?: string): Promise<IngestionJob | IngestionJob[]> {
    if (job_id) {
      const job = await this.repository.getJob(project_id, job_id);
      if (!job) throw new PlatformError("PROJECT_NOT_FOUND", "Ingestion job was not found.", { project_id, details: { job_id } });
      return job;
    }
    return this.repository.listRecentJobs(project_id);
  }

  private async ingestPaths(project_id: string, paths: string[], mode: IngestionJob["mode"], requested_by: string, requires_confirmation: boolean): Promise<IngestionJob> {
    const workspace = await this.workspaces.getWorkspace(project_id);
    const started = new Date().toISOString();
    const missing = paths.filter((path) => !existsSync(resolve(workspace.rootPath, path)));
    if (missing.length) await this.repository.markStaleChunksForPaths(project_id, missing, "deleted");
    const existing = paths.filter((path) => !missing.includes(path));
    if (mode === "full") {
      await this.repository.markStaleRegistryEntriesExceptPaths?.(project_id, existing, "moved");
    }
    const config = loadProjectConfig(workspace.rootPath);
    const documents = existing.map((path): IngestDocumentInput => {
      const content = readFileSync(resolve(workspace.rootPath, path), "utf8");
      const ids = this.extractor.extractIdsFromMarkdown(content, path, config.ids);
      return {
        path,
        content,
        stable_ids: Array.from(new Set(ids.flatMap((entry) => [entry.stable_id, ...(entry.aliases ?? [])]))),
        heading: ids.find((entry) => entry.heading)?.heading ?? firstHeading(content)
      };
    });
    const extracted = documents.flatMap((document) => this.extractor.extractIdsFromMarkdown(document.content, document.path, config.ids));
    const registryResult = await this.ids.mergeIntoRegistry(project_id, extracted, { replaceSourcePaths: existing });
    const ingestResult = await this.lightrag.ingestPaths(project_id, existing, mode, documents);
    const job: IngestionJob = {
      job_id: randomUUID(),
      project_id,
      mode,
      status: "completed",
      requested_by,
      requires_confirmation,
      files_scanned: paths.length,
      files_indexed: ingestResult.indexed,
      warnings: [...registryResult.warnings, ...ingestResult.warnings, ...missing.map((path) => `Marked stale because file is missing: ${path}`)],
      errors: [],
      started_at: started,
      completed_at: new Date().toISOString()
    };
    await this.repository.saveJob(job);
    return job;
  }
}

function firstHeading(content: string): string | undefined {
  return content.split(/\r?\n/).find((line) => line.startsWith("# "))?.replace(/^#\s+/, "");
}

function listIndexableFiles(root: string, config: ProjectConfig): string[] {
  const output: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (shouldIgnoreEntry(name.name)) continue;
      const fullPath = join(dir, name.name);
      if (name.isDirectory()) visit(fullPath);
      if (name.isFile()) {
        const path = normalizePath(relative(root, fullPath));
        if (isIndexablePath(path, config)) output.push(path);
      }
    }
  };
  visit(root);
  return output;
}

function isIndexablePath(path: string, config: ProjectConfig): boolean {
  if (!/\.(md|mdx|ts|tsx|js|jsx|php|blade\.php|json|yml|yaml|html|css|xml|txt|dbml)$/.test(path)) return false;
  if (config.indexing.ignore.some((pattern) => globMatches(path, pattern))) return false;
  return config.indexing.include.some((pattern) => globMatches(path, pattern));
}

function shouldIgnoreEntry(name: string): boolean {
  return [
    ".git",
    "node_modules",
    ".project-context",
    "dist",
    "coverage",
    ".vite"
  ].includes(name) || name.startsWith(".env") || name.endsWith(".tsbuildinfo") || name === "package-lock.json";
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function globMatches(path: string, pattern: string): boolean {
  const normalized = normalizePath(pattern).replace(/^["']|["']$/g, "");
  if (!normalized) return false;
  if (!normalized.includes("*")) return path === normalized || path.startsWith(`${normalized.replace(/\/$/, "")}/`);
  const regex = new RegExp(`^${globToRegex(normalized)}$`);
  return regex.test(path);
}

function globToRegex(pattern: string): string {
  let output = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        output += ".*";
        i += 1;
      } else {
        output += "[^/]*";
      }
      continue;
    }
    output += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return output;
}
