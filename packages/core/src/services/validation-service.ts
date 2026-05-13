import { resolve } from "node:path";
import { PlatformError } from "../errors/platform-error.js";
import { ProjectWorkspaceService } from "./project-workspace-service.js";

export class ValidationService {
  constructor(private readonly workspaces: ProjectWorkspaceService) {}

  async assertProjectExists(project_id: string) {
    return this.workspaces.getWorkspace(project_id);
  }

  async assertPathBelongsToRoot(project_id: string, path: string): Promise<string> {
    const workspace = await this.workspaces.getWorkspace(project_id);
    const resolved = resolve(workspace.rootPath, path);
    if (!resolved.startsWith(workspace.rootPath)) {
      throw new PlatformError("VALIDATION_ERROR", "Path must belong to the workspace root.", { project_id, details: { path } });
    }
    return resolved;
  }

  assertStableId(id: string): void {
    if (!/^[A-Z]+-[A-Z0-9]+-[0-9A-Z]+$/.test(id)) {
      throw new PlatformError("VALIDATION_ERROR", "Stable IDs must use <CATEGORY>-<DOMAIN>-<SEQUENCE>.", { details: { id } });
    }
  }
}
