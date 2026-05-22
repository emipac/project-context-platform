import type { DocumentSelector, LightRagAdapter, LightRagSearchBudget } from "../ports/adapters.js";
import { ProjectWorkspaceService } from "./project-workspace-service.js";

export class RetrievalService {
  constructor(private readonly workspaces: ProjectWorkspaceService, private readonly lightrag: LightRagAdapter) {}

  async searchDocs(project_id: string | undefined, query: string, budget?: LightRagSearchBudget) {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    return this.lightrag.searchDocs(workspace.project_id, query, budget);
  }

  async getSpecContext(project_id: string | undefined, spec_id: string, includeNeighbors?: boolean) {
    const trimmed = spec_id.trim();
    if (!trimmed) return [];
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    return this.lightrag.getSpecContext(workspace.project_id, trimmed, includeNeighbors);
  }

  async getRelatedCode(project_id: string | undefined, featureOrReq: string, budget?: LightRagSearchBudget) {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    return this.lightrag.getRelatedCode(workspace.project_id, featureOrReq, budget);
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
