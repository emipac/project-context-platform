import { existsSync, rmSync, unlinkSync } from "node:fs";
import type { DeleteProjectResultDTO } from "../domain/types.js";
import { PlatformError } from "../errors/platform-error.js";
import type { GraphitiAdapter, LightRagAdapter, MetadataRepository } from "../ports/adapters.js";
import { ProjectWorkspaceService } from "./project-workspace-service.js";

export class ProjectDeletionService {
  constructor(
    private readonly workspaces: ProjectWorkspaceService,
    private readonly repository: MetadataRepository,
    private readonly lightrag: LightRagAdapter,
    private readonly graphiti: GraphitiAdapter
  ) {}

  async deleteProject(
    project_id: string,
    options: { confirmed?: boolean; deleteProjectContextDir?: boolean; requested_by?: string } = {}
  ): Promise<DeleteProjectResultDTO> {
    const trimmed = project_id.trim();
    if (!trimmed) throw new PlatformError("VALIDATION_ERROR", "project_id is required.", { project_id: null });
    if (!options.confirmed) throw new PlatformError("CONFIRMATION_REQUIRED", undefined, { project_id: trimmed });

    const workspace = await this.workspaces.getWorkspace(trimmed);
    const warnings: string[] = [];

    try {
      await this.repository.deleteProject(trimmed);
    } catch (err) {
      throw err instanceof PlatformError ? err : PlatformError.mapUnknown(err);
    }

    let lightragDeleted = false;
    try {
      await this.lightrag.deleteProject(trimmed);
      lightragDeleted = true;
    } catch (err) {
      warnings.push(`LightRAG cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    let graphitiDeleted = false;
    try {
      await this.graphiti.deleteProject(trimmed);
      graphitiDeleted = true;
    } catch (err) {
      warnings.push(`Graphiti cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    let projectContextDeleted = false;
    const safeUnlink = (path: string) => {
      if (!path || !existsSync(path)) return;
      try {
        unlinkSync(path);
        projectContextDeleted = true;
      } catch (err) {
        warnings.push(`Could not remove ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const safeRmDir = (path: string) => {
      if (!path || !existsSync(path)) return;
      try {
        rmSync(path, { recursive: true, force: true });
        projectContextDeleted = true;
      } catch (err) {
        warnings.push(`Could not remove directory ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    if (options.deleteProjectContextDir) {
      safeUnlink(workspace.metadataDbPath);
      safeUnlink(workspace.toolCallLogPath);
      safeUnlink(workspace.idRegistryPath);
      safeUnlink(workspace.configPath);
      safeRmDir(workspace.lightragIndexPath);
    } else {
      safeUnlink(workspace.toolCallLogPath);
      safeUnlink(workspace.idRegistryPath);
      safeRmDir(workspace.lightragIndexPath);
    }

    const { removedFromCatalog, removedFromRegistry } = await this.workspaces.removeRegisteredWorkspace(trimmed);

    return {
      project_id: trimmed,
      removedFromCatalog,
      removedFromRegistry,
      sqliteDeleted: true,
      lightragDeleted,
      graphitiDeleted,
      projectContextDeleted,
      warnings
    };
  }
}
