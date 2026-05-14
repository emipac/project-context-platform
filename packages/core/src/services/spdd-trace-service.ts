import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { loadProjectConfig } from "../config/project-config.js";
import type {
  RecordSpddRunDTO,
  SpddArtifact,
  SpddArtifactType,
  SpddTraceFilter,
  SpddTraceLink,
  SpddTraceRelation,
  SpddTraceResponse,
  SpddTraceTargetType,
  SpddWorkRun,
  SpddWorkRunStatus
} from "../domain/types.js";
import { PlatformError } from "../errors/platform-error.js";
import type { GraphitiAdapter, MetadataRepository, ToolCallLogger } from "../ports/adapters.js";
import { IdExtractor } from "./id-registry-service.js";
import { ProjectWorkspaceService } from "./project-workspace-service.js";

const SPDD_SCAN_DIRS = ["spdd/prompt", "spdd/analysis", "spdd/plan", "spdd/review"] as const;

export class SpddTraceService {
  private readonly extractor = new IdExtractor();

  constructor(
    private readonly workspaces: ProjectWorkspaceService,
    private readonly repository: MetadataRepository,
    private readonly graphiti: GraphitiAdapter,
    private readonly toolCalls?: ToolCallLogger
  ) {}

  async syncArtifacts(project_id?: string): Promise<SpddTraceResponse> {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    const rootPath = resolve(workspace.rootPath);
    const pid = workspace.project_id;
    const now = new Date().toISOString();
    const warnings: string[] = [];

    const relativePaths = collectSpddMarkdownFiles(rootPath);
    const diskArtifacts = new Map<string, SpddArtifact>();
    const config = loadProjectConfig(workspace.rootPath);

    for (const source_path of relativePaths) {
      const absolutePath = safeResolveUnderRoot(rootPath, source_path);
      try {
        const content = readFileSync(absolutePath, "utf8");
        const content_hash = sha256Hex(content);
        const artifact_id = sha256Hex(`${pid}:${source_path}`);
        const stable_ids = uniqueStableIds(
          this.extractor.extractIdsFromMarkdown(content, source_path, config.ids).map((item) => item.stable_id)
        );
        const title = extractFirstMarkdownHeading(content);
        diskArtifacts.set(source_path, {
          project_id: pid,
          artifact_id,
          artifact_type: classifyArtifactType(source_path),
          source_path,
          title,
          stable_ids,
          content_hash,
          status: "current",
          first_seen_at: now,
          last_seen_at: now
        });
      } catch (err) {
        warnings.push(`Skipped unreadable SPDD artifact: ${source_path} (${err instanceof Error ? err.message : String(err)})`);
      }
    }

    const existing = await this.repository.listSpddArtifacts(pid, { include_stale: true, limit: 10_000 });
    const savedPaths = new Set(diskArtifacts.keys());
    const next: SpddArtifact[] = [];

    for (const artifact of diskArtifacts.values()) {
      const prior = existing.find((item) => item.source_path === artifact.source_path);
      next.push({
        ...artifact,
        first_seen_at: prior?.first_seen_at ?? artifact.first_seen_at,
        last_seen_at: now,
        status: "current"
      });
    }

    for (const prior of existing) {
      if (!savedPaths.has(prior.source_path)) {
        next.push({
          ...prior,
          status: "missing",
          last_seen_at: now
        });
      }
    }

    await this.repository.saveSpddArtifacts(pid, next);
    const response = await this.listTrace(pid, { include_stale: true, limit: 200 });
    response.warnings.push(...warnings);
    return response;
  }

  async recordRun(project_id: string | undefined, input: RecordSpddRunDTO): Promise<SpddTraceResponse> {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    const pid = workspace.project_id;
    const rootPath = resolve(workspace.rootPath);
    const warnings: string[] = [];

    const summary = typeof input.summary === "string" ? input.summary.trim() : "";
    if (!summary) throw new PlatformError("VALIDATION_ERROR", "summary is required.");
    if (summary.length > 1000) throw new PlatformError("VALIDATION_ERROR", "summary must be at most 1000 characters.");

    const config = loadProjectConfig(workspace.rootPath);
    const now = new Date().toISOString();
    const run_id = `IMPL-SPDD-${randomBytes(4).toString("hex").toUpperCase()}`;
    const relation: SpddTraceRelation = input.relation ?? "referenced";

    let artifact_id = input.artifact_id?.trim();
    let artifact_path = normalizeRelativePath(input.artifact_path);

    if (artifact_path && !artifact_id) {
      artifact_id = sha256Hex(`${pid}:${artifact_path}`);
    }

    let ensuredArtifact: SpddArtifact | undefined;
    if (artifact_path) {
      const abs = safeResolveUnderRoot(rootPath, artifact_path);
      if (existsSync(abs)) {
        ensuredArtifact = await this.ensureArtifactRow(pid, rootPath, artifact_path, config, now);
      } else {
        warnings.push(`artifact_path not found on disk: ${artifact_path}`);
      }
    }

    if (!artifact_id && artifact_path) artifact_id = sha256Hex(`${pid}:${artifact_path}`);

    const title =
      input.title?.trim() ||
      ensuredArtifact?.title ||
      summary.slice(0, 120) ||
      "Recorded run";

    const status: SpddWorkRunStatus = input.status ?? "completed";

    const run: SpddWorkRun = {
      project_id: pid,
      run_id,
      artifact_id,
      artifact_path,
      title,
      summary,
      status,
      actor: input.actor,
      channel: input.channel,
      started_at: now,
      completed_at: now
    };

    const registry = await this.repository.listRegistryEntries(pid);
    const chunks = await this.repository.listChunks(pid);
    const toolCallIds = new Set<string>();
    if (this.toolCalls) {
      for (const entry of await this.toolCalls.list(pid)) toolCallIds.add(entry.call_id);
    }

    const links: SpddTraceLink[] = [];

    const pushLink = (
      target_type: SpddTraceTargetType,
      target_id: string,
      extras: Partial<Pick<SpddTraceLink, "source_path" | "chunk_id" | "stable_id">>,
      status: SpddTraceLink["status"]
    ) => {
      const link_id = sha256Hex(`${pid}:${run_id}:${target_type}:${target_id}:${relation}`);
      links.push({
        project_id: pid,
        link_id,
        run_id,
        target_type,
        target_id,
        relation,
        ...extras,
        status,
        created_at: now
      });
    };

    for (const sid of input.stable_ids ?? []) {
      const trimmed = sid.trim();
      if (!trimmed) continue;
      const entries = registry.filter((entry) => entry.stable_id === trimmed);
      const status =
        entries.length === 0 ? "unresolved" : entries.some((entry) => entry.status === "current") ? "current" : "stale";
      pushLink("stable_id", trimmed, { stable_id: trimmed }, status);
    }

    for (const path of input.source_paths ?? []) {
      const relPath = normalizeRelativePath(path);
      if (!relPath) continue;
      const chunk = chunks.find((item) => item.source_path === relPath);
      const regHits = registry.filter((entry) => entry.source_path === relPath);
      let linkStatus: SpddTraceLink["status"];
      if (!chunk && regHits.length === 0) linkStatus = "unresolved";
      else if (chunk?.status === "stale" || regHits.some((entry) => entry.status === "stale")) linkStatus = "stale";
      else linkStatus = "current";
      pushLink("source_path", relPath, { source_path: relPath }, linkStatus);
    }

    for (const chunk_id of input.chunk_ids ?? []) {
      const trimmed = chunk_id.trim();
      if (!trimmed) continue;
      const chunk = chunks.find((item) => item.chunk_id === trimmed);
      const status = !chunk ? "unresolved" : chunk.status === "stale" ? "stale" : "current";
      pushLink("chunk", trimmed, { chunk_id: trimmed, source_path: chunk?.source_path }, status);
    }

    for (const ref of input.feature_refs ?? []) {
      const trimmed = ref.trim();
      if (!trimmed) continue;
      pushLink("feature", trimmed, {}, "current");
    }

    for (const tc of input.tool_call_ids ?? []) {
      const trimmed = tc.trim();
      if (!trimmed) continue;
      const status = toolCallIds.has(trimmed) ? "current" : "unresolved";
      pushLink("tool_call", trimmed, {}, status);
    }

    for (const mid of input.memory_event_ids ?? []) {
      const trimmed = mid.trim();
      if (!trimmed) continue;
      pushLink("memory_event", trimmed, {}, "current");
    }

    await this.repository.saveSpddWorkRun(run);
    if (links.length) await this.repository.saveSpddTraceLinks(pid, links);

    if (input.mirror_to_memory) {
      try {
        await this.graphiti.rememberImplementationSummary(pid, {
          type: "implementation_summary",
          id: run_id,
          topic: `spdd trace:${title}`,
          summary,
          related_requirements: input.stable_ids ?? [],
          related_files: uniqueStrings([...(input.source_paths?.map(normalizeRelativePath).filter(Boolean) as string[]), ...(artifact_path ? [artifact_path] : [])]),
          status: run.status
        });
      } catch (err) {
        warnings.push(`Graphiti mirror failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const mergedWarnings = [...warnings];
    const response = await this.listTrace(pid, { run_id, limit: 200 });
    response.warnings.push(...mergedWarnings);
    return response;
  }

  async listTrace(project_id?: string, filter?: SpddTraceFilter): Promise<SpddTraceResponse> {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    const pid = workspace.project_id;
    const lim = clampLimit(filter?.limit);

    const linkScoped = Boolean(filter?.stable_id || filter?.source_path || filter?.chunk_id || filter?.feature_ref);

    if (linkScoped) {
      const scopedLinks = await this.repository.listSpddTraceLinks(pid, { ...filter, limit: Math.min(500, lim * 5) });
      const runIds = new Set(scopedLinks.map((item) => item.run_id));
      if (runIds.size === 0) {
        return { artifacts: [], runs: [], links: [], warnings: [] };
      }
      const runs = (await this.repository.listSpddWorkRuns(pid, { ...filter, limit: lim })).filter((run) => runIds.has(run.run_id));
      const links = scopedLinks.filter((link) => runIds.has(link.run_id));
      let artifacts = await this.repository.listSpddArtifacts(pid, {
        artifact_type: filter?.artifact_type,
        artifact_id: filter?.artifact_id,
        artifact_path: filter?.artifact_path,
        include_stale: filter?.include_stale,
        limit: lim
      });
      const artifactNeedle = new Set(runs.map((run) => run.artifact_id).filter(Boolean) as string[]);
      if (artifactNeedle.size > 0) artifacts = artifacts.filter((artifact) => artifactNeedle.has(artifact.artifact_id));
      else artifacts = [];

      return {
        artifacts: artifacts.slice(0, lim),
        runs: runs.slice(0, lim),
        links: links.slice(0, lim),
        warnings: []
      };
    }

    const [artifacts, runs, links] = await Promise.all([
      this.repository.listSpddArtifacts(pid, filter),
      this.repository.listSpddWorkRuns(pid, filter),
      this.repository.listSpddTraceLinks(pid, filter)
    ]);

    return {
      artifacts: artifacts.slice(0, lim),
      runs: runs.slice(0, lim),
      links: links.slice(0, lim),
      warnings: []
    };
  }

  async lookupByTarget(project_id: string | undefined, filter: SpddTraceFilter): Promise<SpddTraceResponse> {
    const hasTarget = Boolean(
      filter.stable_id ||
        filter.source_path ||
        filter.chunk_id ||
        filter.feature_ref ||
        (filter.target_type && filter.target_id)
    );
    if (!hasTarget) throw new PlatformError("VALIDATION_ERROR", "Lookup requires at least one target filter.");

    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    const pid = workspace.project_id;
    const lim = clampLimit(filter.limit);

    const links = await this.repository.listSpddTraceLinks(pid, { ...filter, limit: Math.min(500, lim * 5) });
    const runIds = new Set(links.map((link) => link.run_id));
    const runs = (await this.repository.listSpddWorkRuns(pid, { limit: 2000 })).filter((run) => runIds.has(run.run_id)).slice(0, lim);
    const artifactIds = new Set(runs.map((run) => run.artifact_id).filter(Boolean) as string[]);
    let artifacts = await this.repository.listSpddArtifacts(pid, { include_stale: true, limit: 2000 });
    artifacts = artifacts.filter((artifact) => artifactIds.has(artifact.artifact_id)).slice(0, lim);

    return {
      artifacts,
      runs,
      links: links.slice(0, lim),
      warnings: []
    };
  }

  private async ensureArtifactRow(
    project_id: string,
    rootPath: string,
    source_path: string,
    config: ReturnType<typeof loadProjectConfig>,
    now: string
  ): Promise<SpddArtifact> {
    const absolutePath = safeResolveUnderRoot(rootPath, source_path);
    const content = readFileSync(absolutePath, "utf8");
    const content_hash = sha256Hex(content);
    const artifact_id = sha256Hex(`${project_id}:${source_path}`);
    const stable_ids = uniqueStableIds(
      this.extractor.extractIdsFromMarkdown(content, source_path, config.ids).map((item) => item.stable_id)
    );
    const artifact: SpddArtifact = {
      project_id,
      artifact_id,
      artifact_type: classifyArtifactType(source_path),
      source_path,
      title: extractFirstMarkdownHeading(content),
      stable_ids,
      content_hash,
      status: "current",
      first_seen_at: now,
      last_seen_at: now
    };
    const existing = await this.repository.listSpddArtifacts(project_id, { artifact_id, include_stale: true, limit: 1 });
    if (existing[0]) artifact.first_seen_at = existing[0].first_seen_at;
    await this.repository.saveSpddArtifacts(project_id, [artifact]);
    return artifact;
  }
}

function clampLimit(limit?: number): number {
  const n = limit ?? 100;
  return Math.min(200, Math.max(1, n));
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeRelativePath(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
  return trimmed || undefined;
}

function safeResolveUnderRoot(rootPath: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) throw new PlatformError("VALIDATION_ERROR", "artifact_path is invalid.");
  const resolved = resolve(rootPath, normalized);
  const rootResolved = resolve(rootPath);
  const rel = relative(rootResolved, resolved);
  if (rel.startsWith("..") || rel === "..") {
    throw new PlatformError("VALIDATION_ERROR", "Path escapes workspace root.", { details: { relativePath } });
  }
  return resolved;
}

function collectSpddMarkdownFiles(rootPath: string): string[] {
  const files: string[] = [];
  for (const dir of SPDD_SCAN_DIRS) {
    const absDir = resolve(rootPath, dir);
    if (!existsSync(absDir)) continue;
    walkMarkdown(absDir, rootPath, files);
  }
  return uniqueStrings(files).sort();
}

function walkMarkdown(dir: string, rootPath: string, files: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(entryPath, rootPath, files);
    else if (entry.isFile() && /\.(md|mdx|txt)$/i.test(entry.name)) files.push(relative(rootPath, entryPath).replace(/\\/g, "/"));
  }
}

function classifyArtifactType(sourcePath: string): SpddArtifactType {
  const norm = sourcePath.replace(/\\/g, "/").toLowerCase();
  if (norm.startsWith("spdd/prompt/") || norm === "spdd/prompt") return "prompt";
  if (norm.startsWith("spdd/analysis/") || norm === "spdd/analysis") return "analysis";
  if (norm.startsWith("spdd/plan/") || norm === "spdd/plan") return "plan";
  if (norm.startsWith("spdd/review/") || norm === "spdd/review") return "review";
  const base = basename(norm);
  if (base.includes("plan")) return "plan";
  if (base.includes("review")) return "review";
  return "unknown";
}

function extractFirstMarkdownHeading(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const match = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (match) return match[1].trim();
  }
  return undefined;
}

function uniqueStableIds(ids: string[]): string[] {
  return uniqueStrings(ids);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
