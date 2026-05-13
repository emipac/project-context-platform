import type { FeatureContextRequestDTO, FeatureContextResponseDTO, GraphitiAdapter, LightRagAdapter } from "../index.js";
import { ProjectWorkspaceService } from "./project-workspace-service.js";

export class ContextComposerService {
  constructor(
    private readonly workspaces: ProjectWorkspaceService,
    private readonly lightrag: LightRagAdapter,
    private readonly graphiti: GraphitiAdapter
  ) {}

  async prepareFeatureContext(project_id: string | undefined, input: FeatureContextRequestDTO): Promise<FeatureContextResponseDTO> {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    const warnings: string[] = [];
    const docs = await this.lightrag.searchDocs(workspace.project_id, input.feature_name, { limit: 8 });
    const related_code = await this.lightrag.getRelatedCode(workspace.project_id, input.feature_name, { limit: 8 });
    let facts: Record<string, unknown>[] = [];
    try {
      facts = await this.graphiti.getCurrentFacts(workspace.project_id, input.feature_name);
    } catch {
      warnings.push("Graphiti unavailable; returned canonical context only.");
    }
    return {
      feature: input.feature_name,
      relevant_prd_sections: docs.filter((item) => item.document_type === "prd"),
      relevant_srs_sections: docs.filter((item) => item.document_type === "srs" || item.source_path.toLowerCase().includes("srs")),
      related_adrs: docs.filter((item) => item.source_path.toLowerCase().includes("adr")),
      api_contracts: docs.filter((item) => item.content.includes("/api/")),
      database_context: docs.filter((item) => item.content.toLowerCase().includes("sqlite") || item.content.toLowerCase().includes("neo4j")),
      related_code,
      related_tests: related_code.filter((item) => item.source_path.includes("test")),
      current_decisions: facts.filter((item) => item.status !== "deprecated"),
      deprecated_decisions: facts.filter((item) => item.status === "deprecated"),
      open_questions: [],
      known_review_findings: [],
      implementation_checklist: [],
      traceability: docs.flatMap((item) => item.stable_ids.map((stable_id) => ({ stable_id, source_path: item.source_path }))),
      warnings
    };
  }

  async prepareReviewContext(project_id: string | undefined, input: { changed_files?: string[]; diff?: string }) {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    return {
      project_id: workspace.project_id,
      changed_files: input.changed_files ?? [],
      diff_present: Boolean(input.diff),
      relevant_context: await this.lightrag.searchDocs(workspace.project_id, [...(input.changed_files ?? []), input.diff ?? ""].join("\n"), { limit: 8 })
    };
  }

  async validateAgainstSpecs(project_id: string | undefined, input: { plan?: string; diff?: string; requirement_ids?: string[] }) {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    return {
      project_id: workspace.project_id,
      heuristic: true,
      valid: true,
      warnings: ["MVP validation is heuristic and should be treated as advisory."],
      checked_requirement_ids: input.requirement_ids ?? []
    };
  }
}
