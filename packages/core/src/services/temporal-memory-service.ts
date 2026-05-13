import { randomUUID } from "node:crypto";
import type { GraphitiAdapter, MemoryReviewPreviewDTO } from "../index.js";
import { PlatformError } from "../errors/platform-error.js";
import { ProjectWorkspaceService } from "./project-workspace-service.js";

const stableIdPattern = /^(DEC|REQCHG|REV|IMPL)-[A-Z0-9]+-[0-9A-Z]+$/;

export class TemporalMemoryService {
  constructor(private readonly workspaces: ProjectWorkspaceService, private readonly graphiti: GraphitiAdapter) {}

  async previewMemoryWrite(project_id: string, draft: Record<string, unknown>): Promise<MemoryReviewPreviewDTO> {
    const type = String(draft.type ?? "decision");
    const highRisk = ["requirement_change", "review_finding"].includes(type);
    const warnings: Array<Record<string, unknown>> = [];
    if (type === "requirement_change" && typeof draft.new_fact === "string") {
      warnings.push({
        code: "CANONICAL_DOC_UPDATE_NOT_CONFIRMED",
        message: "Requirement change preview cannot confirm canonical documentation has been updated.",
        retryable: false
      });
    }
    return {
      normalized_payload: { id: draft.id ?? generateMemoryId(type), ...draft },
      warnings,
      risk_tier: highRisk ? "high_risk" : "low_risk"
    };
  }

  async commitHighRisk(project_id: string, draft: Record<string, unknown>, approval: Record<string, unknown>): Promise<void> {
    if (approval.decision !== "approved") {
      throw new PlatformError("MEMORY_APPROVAL_REQUIRED", "High-risk memory write requires approval.", { project_id });
    }
    await this.persist(project_id, draft);
    await this.graphiti.rememberApproval(project_id, approval);
  }

  async commitLowRisk(project_id: string, event: Record<string, unknown>): Promise<void> {
    await this.persist(project_id, event);
  }

  async getCurrentFacts(project_id: string | undefined, topic: string, related_requirement_id?: string) {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    return this.graphiti.getCurrentFacts(workspace.project_id, topic, related_requirement_id);
  }

  async getHistory(project_id: string | undefined, topic: string, include_deprecated?: boolean) {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    return this.graphiti.getHistory(workspace.project_id, topic, include_deprecated);
  }

  async rememberApproval(project_id: string, payload: Record<string, unknown>) {
    await this.graphiti.rememberApproval(project_id, payload);
  }

  private async persist(project_id: string, event: Record<string, unknown>): Promise<void> {
    const type = String(event.type ?? "decision");
    if (typeof event.id === "string" && ["decision", "requirement_change", "review_finding", "implementation_summary"].includes(type) && !stableIdPattern.test(event.id)) {
      throw new PlatformError("VALIDATION_ERROR", "Stable memory IDs must use <CATEGORY>-<DOMAIN>-<SEQUENCE>.", { project_id, details: { id: event.id } });
    }
    if (type === "requirement_change") return this.graphiti.rememberRequirementChange(project_id, event);
    if (type === "review_finding") return this.graphiti.rememberReview(project_id, event);
    if (type === "implementation_summary") return this.graphiti.rememberImplementationSummary(project_id, event);
    return this.graphiti.rememberDecision(project_id, event);
  }
}

function generateMemoryId(type: string): string {
  const prefix = type === "requirement_change" ? "REQCHG" : type === "review_finding" ? "REV" : type === "implementation_summary" ? "IMPL" : "DEC";
  return `${prefix}-LOCAL-${randomUUID().slice(0, 8).toUpperCase()}`;
}
