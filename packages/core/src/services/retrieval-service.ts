import type { DocumentSelector, LightRagAdapter } from "../ports/adapters.js";
import { ProjectWorkspaceService } from "./project-workspace-service.js";

export class RetrievalService {
  constructor(private readonly workspaces: ProjectWorkspaceService, private readonly lightrag: LightRagAdapter) {}

  async searchDocs(project_id: string | undefined, query: string, opts?: Record<string, unknown>) {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    return this.lightrag.searchDocs(workspace.project_id, query, opts);
  }

  async getSpecContext(project_id: string | undefined, spec_id: string, includeNeighbors?: boolean) {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    return this.lightrag.getSpecContext(workspace.project_id, spec_id, includeNeighbors);
  }

  async getRelatedCode(project_id: string | undefined, featureOrReq: string, opts?: Record<string, unknown>) {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    return this.lightrag.getRelatedCode(workspace.project_id, featureOrReq, opts);
  }

  async getRequirementSources(project_id: string | undefined, requirement_id: string) {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    return this.lightrag.getRequirementSources(workspace.project_id, requirement_id);
  }

  async getDocument(project_id: string | undefined, selector: DocumentSelector) {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    return this.lightrag.getDocument(workspace.project_id, selector);
  }
}
