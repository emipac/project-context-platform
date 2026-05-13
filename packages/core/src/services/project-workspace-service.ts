import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ProjectWorkspace } from "../domain/types.js";
import { defaultProjectConfig } from "../config/project-config.js";
import { GlobalRegistryStore } from "../config/global-registry-store.js";
import { ProjectCatalogStore } from "../config/project-catalog-store.js";
import { PlatformError } from "../errors/platform-error.js";

export interface RegisterWorkspaceInput {
  project_id?: string;
  name?: string;
  rootPath: string;
}

export class ProjectWorkspaceService {
  constructor(private readonly registry = new GlobalRegistryStore(), private readonly catalog = new ProjectCatalogStore()) {}

  async registerWorkspace(input: RegisterWorkspaceInput): Promise<ProjectWorkspace> {
    const rootPath = resolve(input.rootPath);
    if (!existsSync(rootPath)) throw new PlatformError("INVALID_ROOT", "Workspace root is invalid.", { details: { rootPath } });
    const project_id = input.project_id ?? basename(rootPath).replace(/[^a-zA-Z0-9_-]/g, "-");
    const existing = this.registry.get(project_id);
    const now = new Date().toISOString();
    const contextDir = join(rootPath, ".project-context");
    mkdirSync(contextDir, { recursive: true });
    const workspace: ProjectWorkspace = {
      ...existing,
      project_id,
      name: input.name ?? existing?.name ?? project_id,
      rootPath,
      status: "active",
      registryPath: this.registry.getPath(),
      configPath: join(contextDir, "config.yml"),
      lightragIndexPath: join(contextDir, "lightrag"),
      graphitiNamespace: project_id,
      metadataDbPath: join(contextDir, "metadata.sqlite"),
      idRegistryPath: join(contextDir, "id-registry.json"),
      toolCallLogPath: join(contextDir, "tool-calls.jsonl"),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    ensureConfig(workspace.configPath, defaultProjectConfig(project_id));
    if (existing) {
      this.registry.update(project_id, workspace);
    } else {
      this.registry.register(workspace);
    }
    return this.catalog.upsert(workspace);
  }

  async listWorkspaces(): Promise<ProjectWorkspace[]> {
    const catalogProjects = this.catalog.list();
    if (!catalogProjects.length) return this.registry.listRegistered();
    const byId = new Map(catalogProjects.map((project) => [project.project_id, project]));
    for (const project of this.registry.listRegistered()) {
      if (!byId.has(project.project_id)) byId.set(project.project_id, project);
    }
    return Array.from(byId.values()).sort((left, right) => left.project_id.localeCompare(right.project_id));
  }

  async getWorkspace(project_id: string): Promise<ProjectWorkspace> {
    const workspace = this.catalog.get(project_id) ?? this.registry.get(project_id);
    if (!workspace) throw new PlatformError("PROJECT_NOT_FOUND", undefined, { project_id });
    return workspace;
  }

  async removeRegisteredWorkspace(project_id: string): Promise<{ workspace: ProjectWorkspace; removedFromCatalog: boolean; removedFromRegistry: boolean }> {
    const workspace = await this.getWorkspace(project_id);
    const catalogRemoved = Boolean(this.catalog.remove(project_id));
    let removedFromRegistry = false;
    if (this.registry.get(project_id)) {
      this.registry.remove(project_id);
      removedFromRegistry = true;
    }
    return { workspace, removedFromCatalog: catalogRemoved, removedFromRegistry };
  }

  async patchWorkspace(project_id: string, patch: Partial<ProjectWorkspace>): Promise<ProjectWorkspace> {
    const updated = this.registry.get(project_id)
      ? this.registry.update(project_id, patch)
      : { ...(await this.getWorkspace(project_id)), ...patch, updatedAt: new Date().toISOString() };
    return this.catalog.upsert(updated);
  }

  async resolveProjectOrActive(project_id?: string): Promise<ProjectWorkspace> {
    if (project_id) return this.getWorkspace(project_id);
    const active = this.registry.getActive();
    if (!active) throw new PlatformError("PROJECT_NOT_FOUND", "No active project workspace is configured.");
    return active;
  }
}

function ensureConfig(path: string, config: ReturnType<typeof defaultProjectConfig>): void {
  if (existsSync(path)) return;
  const yaml = [
    "indexing:",
    `  include: [${config.indexing.include.join(", ")}]`,
    `  ignore: [${config.indexing.ignore.join(", ")}]`,
    `  max_chunks_per_section: ${config.indexing.max_chunks_per_section}`,
    `  duplicate_id_policy: ${config.indexing.duplicate_id_policy}`,
    "ids:",
    `  required_prefixes: [${config.ids.required_prefixes.join(", ")}]`,
    `  project_domain: ${config.ids.project_domain}`,
    "  legacy_patterns:",
    `    adr_headings: ${config.ids.legacy_patterns.adr_headings}`,
    `    adr_filenames: ${config.ids.legacy_patterns.adr_filenames}`,
    `    use_cases: ${config.ids.legacy_patterns.use_cases}`,
    `    plan_items: ${config.ids.legacy_patterns.plan_items}`,
    "lightrag:",
    `  index_path: ${config.lightrag.index_path}`,
    `  timeout_ms: ${config.lightrag.timeout_ms}`,
    `  base_url: ${config.lightrag.base_url}`,
    `  health_path: ${config.lightrag.health_path}`,
    "graphiti:",
    `  namespace: ${config.graphiti.namespace}`,
    `  timeout_ms: ${config.graphiti.timeout_ms}`,
    `  base_url: ${config.graphiti.base_url}`,
    `  health_path: ${config.graphiti.health_path}`,
    "memory:",
    `  high_risk_types: [${config.memory.high_risk_types.join(", ")}]`,
    `  low_risk_types: [${config.memory.low_risk_types.join(", ")}]`,
    "api:",
    `  host: ${config.api.host}`,
    `  port: ${config.api.port}`,
    "ui:",
    `  enabled: ${config.ui.enabled}`
  ].join("\n");
  writeFileSync(path, `${yaml}\n`);
}
