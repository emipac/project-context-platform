import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ProjectWorkspace } from "../domain/types.js";
import { PlatformError } from "../errors/platform-error.js";

interface RegistryFile {
  active_project_id: string | null;
  workspaces: ProjectWorkspace[];
}

export class GlobalRegistryStore {
  constructor(private readonly registryPath = process.env.PCP_REGISTRY_PATH ?? ".project-context/global-registry.json") {}

  getPath(): string {
    return resolve(this.registryPath);
  }

  listRegistered(): ProjectWorkspace[] {
    return this.read().workspaces;
  }

  register(workspace: ProjectWorkspace): void {
    const current = this.read();
    if (current.workspaces.some((item) => item.project_id === workspace.project_id)) {
      throw new PlatformError("PROJECT_ALREADY_EXISTS", undefined, { project_id: workspace.project_id });
    }
    current.workspaces.push(workspace);
    if (!current.active_project_id) current.active_project_id = workspace.project_id;
    this.write(current);
  }

  remove(project_id: string): ProjectWorkspace {
    const current = this.read();
    const index = current.workspaces.findIndex((item) => item.project_id === project_id);
    if (index === -1) throw new PlatformError("PROJECT_NOT_FOUND", undefined, { project_id });
    const [removed] = current.workspaces.splice(index, 1);
    if (current.active_project_id === project_id) {
      current.active_project_id = current.workspaces[0]?.project_id ?? null;
    }
    this.write(current);
    return removed;
  }

  update(project_id: string, patch: Partial<ProjectWorkspace>): ProjectWorkspace {
    const current = this.read();
    const index = current.workspaces.findIndex((item) => item.project_id === project_id);
    if (index === -1) throw new PlatformError("PROJECT_NOT_FOUND", undefined, { project_id });
    current.workspaces[index] = { ...current.workspaces[index], ...patch, updatedAt: new Date().toISOString() };
    this.write(current);
    return current.workspaces[index];
  }

  setActiveProject(project_id: string): void {
    const current = this.read();
    if (!current.workspaces.some((item) => item.project_id === project_id)) {
      throw new PlatformError("PROJECT_NOT_FOUND", undefined, { project_id });
    }
    current.active_project_id = project_id;
    this.write(current);
  }

  get(project_id: string): ProjectWorkspace | undefined {
    return this.read().workspaces.find((item) => item.project_id === project_id);
  }

  getActive(): ProjectWorkspace | undefined {
    const current = this.read();
    return current.workspaces.find((item) => item.project_id === current.active_project_id);
  }

  private read(): RegistryFile {
    const fullPath = resolve(this.registryPath);
    if (!existsSync(fullPath)) return { active_project_id: null, workspaces: [] };
    return JSON.parse(readFileSync(fullPath, "utf8")) as RegistryFile;
  }

  private write(value: RegistryFile): void {
    const fullPath = resolve(this.registryPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, JSON.stringify(value, null, 2));
  }
}
