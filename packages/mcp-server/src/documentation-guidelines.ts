import { defaultProjectConfig, loadProjectConfig } from "@pcp/core";
import type { createAppServices } from "@pcp/infra";

type Services = ReturnType<typeof createAppServices>;

export async function getDocumentationGuidelines(services: Services, input: Record<string, unknown>) {
  const requestedProjectId = typeof input.project_id === "string" ? input.project_id : undefined;
  const docType = typeof input.doc_type === "string" ? input.doc_type : "all";
  const workspace = await resolveWorkspace(services, requestedProjectId);
  const config = workspace ? loadProjectConfig(workspace.rootPath) : defaultProjectConfig(requestedProjectId ?? "project");
  const projectId = workspace?.project_id ?? requestedProjectId ?? "project";
  const domain = config.ids.project_domain;

  return {
    project_id: projectId,
    project_domain: domain,
    doc_type: docType,
    canonical_docs: {
      navigation: "docs/DOCUMENTATION-MAP.md",
      architecture: "docs/system/SDD.md",
      scenarios: "docs/system/use-cases.md",
      permissions: "docs/system/authorization-matrix.md",
      decisions: "docs/adr/",
      feature_plans: "docs/features/"
    },
    stable_id_rules: {
      required_prefixes: config.ids.required_prefixes,
      project_domain: domain,
      lookup_tool:
        "After reviewing prefixes with get_documentation_guidelines, call list_stable_ids to inspect occupied registry IDs before creating or renumbering stable IDs. list_stable_ids is read-only (lists existing rows only); use validate_ids when checking duplicate ID health.",
      examples: [
        `ADR-${domain}-0003`,
        "REQ-HIRING-001",
        "AC-HIRING-001",
        "TASK-HIRING-001",
        "NFR-SEC-001"
      ],
      legacy_aliases: {
        adr_headings: config.ids.legacy_patterns.adr_headings
          ? `Legacy ADR headings such as "ADR 0003" are indexed as ADR-${domain}-0003 and kept as aliases.`
          : "Legacy ADR heading extraction is disabled for this project.",
        adr_filenames: config.ids.legacy_patterns.adr_filenames
          ? `ADR filenames such as docs/adr/0003-title.md are indexed as ADR-${domain}-0003 and kept as aliases.`
          : "Legacy ADR filename extraction is disabled for this project.",
        use_cases: config.ids.legacy_patterns.use_cases
          ? "Legacy use-case labels such as UC-3 may be indexed as local aliases."
          : "Legacy use-case labels such as UC-3 are not canonical IDs by default.",
        plan_items: config.ids.legacy_patterns.plan_items
          ? "Legacy plan labels such as Q6.1, P5a, and IQ-6 may be indexed as local aliases."
          : "Legacy plan labels such as Q6.1, P5a, and IQ-6 are not canonical IDs by default."
      }
    },
    changelog_memory_policy: {
      default: "Do not create Markdown changelogs by default.",
      after_meaningful_work: "Call remember_implementation_summary with related files, requirements, and tasks.",
      requirement_changes: "Call remember_requirement_change and update the canonical requirement or design document.",
      decisions: "Call remember_decision. For major architecture decisions, also create or update an ADR.",
      reviews: "Call remember_review for findings and their status.",
      markdown_changelog_exception: "Create a Markdown changelog only when the user explicitly asks for a human-readable release or audit artifact.",
      historical_changelogs: "Keep historical changelogs indexed as legacy context, but do not treat them as required platform state."
    },
    anti_patterns: [
      "Do not rely only on ADR 0003, Q1, P1, or IQ-6 for durable references.",
      "Do not let plan-local labels escape their document without a declared namespace or canonical stable ID.",
      "Do not duplicate canonical documentation changes into daily Markdown changelogs by default."
    ],
    guidance: guidanceForDocType(docType, domain)
  };
}

async function resolveWorkspace(services: Services, projectId: string | undefined) {
  try {
    return await services.workspaces.resolveProjectOrActive(projectId);
  } catch {
    return undefined;
  }
}

function guidanceForDocType(docType: string, domain: string): string[] {
  const common = [
    "Use canonical docs for durable truth, and memory tools for temporal work history.",
    `Use IDs like ADR-${domain}-0003 for project-level decisions and REQ-AREA-001 for durable requirements.`,
    `Before assigning new stable IDs or renumbering IDs, call list_stable_ids to see occupied registry entries (validate_ids remains the duplicate-health check).`
  ];
  if (docType === "adr") {
    return [...common, "Prefer ADR-PROJECT-000N headings for new ADRs. Legacy ADR 000N headings are aliases only."];
  }
  if (docType === "changelog") {
    return [...common, "Prefer remember_implementation_summary over new Markdown changelog files unless the user asks for an audit artifact."];
  }
  if (docType === "feature_plan") {
    return [...common, "Feature plans may use local checklist labels, but every durable requirement, task, and acceptance criterion needs a stable ID."];
  }
  if (docType === "use_cases") {
    return [...common, "Use-case labels may remain readable aliases, but link durable behavior to REQ-* or AC-* IDs."];
  }
  return common;
}
