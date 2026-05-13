import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ProjectWorkspace } from "../domain/types.js";

interface CatalogFile {
  projects: ProjectWorkspace[];
}

export class ProjectCatalogStore {
  constructor(private readonly catalogPath = process.env.PCP_PROJECT_CATALOG_PATH ?? "project-catalog.json") {}

  getPath(): string {
    return resolve(this.catalogPath);
  }

  list(): ProjectWorkspace[] {
    return this.read().projects.map((project) => withAvailability(project));
  }

  get(project_id: string): ProjectWorkspace | undefined {
    const project = this.read().projects.find((item) => item.project_id === project_id);
    return project ? withAvailability(project) : undefined;
  }

  remove(project_id: string): ProjectWorkspace | undefined {
    const current = this.read();
    const index = current.projects.findIndex((item) => item.project_id === project_id);
    if (index === -1) return undefined;
    const [removed] = current.projects.splice(index, 1);
    current.projects.sort((left, right) => left.project_id.localeCompare(right.project_id));
    this.write(current);
    return withAvailability(removed);
  }

  upsert(project: ProjectWorkspace): ProjectWorkspace {
    const current = this.read();
    const now = new Date().toISOString();
    const next = {
      ...project,
      registryPath: project.registryPath ? resolve(project.registryPath) : project.registryPath,
      rootPath: resolve(project.rootPath),
      updatedAt: now
    };
    const index = current.projects.findIndex((item) => item.project_id === next.project_id);
    if (index === -1) {
      current.projects.push(next);
    } else {
      current.projects[index] = { ...current.projects[index], ...next };
    }
    current.projects.sort((left, right) => left.project_id.localeCompare(right.project_id));
    this.write(current);
    return withAvailability(next);
  }

  private read(): CatalogFile {
    const fullPath = this.getPath();
    if (!existsSync(fullPath)) return { projects: [] };
    return JSON.parse(readFileSync(fullPath, "utf8")) as CatalogFile;
  }

  private write(value: CatalogFile): void {
    const fullPath = this.getPath();
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, JSON.stringify(value, null, 2));
  }
}

function withAvailability(project: ProjectWorkspace): ProjectWorkspace {
  if (!existsSync(project.rootPath)) {
    return { ...project, available: false, unavailable_reason: "Project root does not exist." };
  }
  if (project.registryPath && !existsSync(project.registryPath)) {
    return { ...project, available: false, unavailable_reason: "Project registry does not exist." };
  }
  return { ...project, available: true };
}
