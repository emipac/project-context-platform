import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { createAppServices } from "@pcp/infra";
import { registerAllTools } from "./register-all-tools.js";

const services = createAppServices();
const handlers = registerAllTools(services);

const server = new McpServer({
  name: "project-context-platform",
  version: "0.1.0"
});

registerTool("search_docs", "Search canonical project documentation and return traceable results.", {
  project_id: z.string().optional(),
  query: z.string(),
  limit: z.number().optional(),
  document_types: z.array(z.string()).optional()
});

registerTool("get_document", "Retrieve full document chunk content by chunk ID or source path.", {
  project_id: z.string().optional(),
  chunk_id: z.string().optional(),
  source_path: z.string().optional()
});

registerTool("get_spec_context", "Retrieve exact or related specification context by ID or path.", {
  project_id: z.string().optional(),
  spec_id: z.string(),
  include_neighbors: z.boolean().optional()
});

registerTool("get_related_code", "Retrieve source files and tests related to a feature or requirement.", {
  project_id: z.string().optional(),
  feature_name: z.string().optional(),
  requirement_id: z.string().optional(),
  limit: z.number().optional()
});

registerTool("get_requirement_sources", "Return all known canonical sources related to a requirement.", {
  project_id: z.string().optional(),
  requirement_id: z.string()
});

registerTool("get_documentation_guidelines", "Return project-specific documentation, stable ID, and memory guidance for agents.", {
  project_id: z.string().optional(),
  doc_type: z.enum(["adr", "requirements", "feature_plan", "use_cases", "changelog", "all"]).optional()
});

registerTool("remember_decision", "Store a project decision in temporal memory.", {
  project_id: z.string().optional(),
  id: z.string().optional(),
  topic: z.string(),
  decision: z.string(),
  status: z.string().optional(),
  related_requirements: z.array(z.string()).optional(),
  related_tasks: z.array(z.string()).optional(),
  source: z.string().optional()
});

registerTool("remember_review", "Store a code or specification review result.", {
  project_id: z.string().optional(),
  review_id: z.string().optional(),
  topic: z.string(),
  findings: z.array(z.record(z.string(), z.unknown())),
  related_requirements: z.array(z.string()).optional(),
  related_files: z.array(z.string()).optional(),
  status: z.string().optional()
});

registerTool("remember_requirement_change", "Store a temporal change to a requirement.", {
  project_id: z.string().optional(),
  id: z.string().optional(),
  topic: z.string(),
  old_fact: z.string().optional(),
  new_fact: z.string(),
  reason: z.string().optional(),
  related_requirements: z.array(z.string()),
  valid_from: z.string().optional()
});

registerTool("remember_approval", "Store a human approval or rejection.", {
  project_id: z.string().optional(),
  id: z.string().optional(),
  topic: z.string(),
  approved_object_type: z.string(),
  approved_object_ids: z.array(z.string()).optional(),
  decision: z.enum(["approved", "rejected", "needs_changes"]),
  approved_by: z.string().optional(),
  approver_identity_source: z.string().optional(),
  source: z.string().optional(),
  channel: z.string().optional(),
  warnings: z.array(z.string()).optional()
});

registerTool("get_current_facts", "Retrieve currently valid facts for a topic.", {
  project_id: z.string().optional(),
  topic: z.string(),
  related_requirement_id: z.string().optional()
});

registerTool("get_history", "Retrieve temporal history for a topic.", {
  project_id: z.string().optional(),
  topic: z.string(),
  include_deprecated: z.boolean().optional()
});

registerTool("prepare_feature_context", "Prepare full implementation context for a feature.", {
  project_id: z.string().optional(),
  feature_name: z.string(),
  requirement_ids: z.array(z.string()).optional(),
  task_id: z.string().optional()
});

registerTool("prepare_review_context", "Prepare review context for changed files or a diff.", {
  project_id: z.string().optional(),
  changed_files: z.array(z.string()).optional(),
  diff: z.string().optional(),
  requirement_ids: z.array(z.string()).optional()
});

registerTool("validate_against_specs", "Validate an implementation plan or code diff against relevant specifications.", {
  project_id: z.string().optional(),
  plan: z.string().optional(),
  diff: z.string().optional(),
  requirement_ids: z.array(z.string()).optional()
});

registerTool(
  "get_context_freshness",
  "Return a derived context freshness report from SQLite metadata with optional git-vs-index heuristic (not LightRAG).",
  {
    project_id: z.string().optional(),
    include_stale: z.boolean().optional(),
    changed_file_detection: z.enum(["off", "git", "auto"]).optional()
  }
);

registerTool(
  "get_context_quality_metrics",
  "Return deterministic context quality metrics from metadata and MCP tool-call logs.",
  {
    project_id: z.string().optional(),
    include_stale: z.boolean().optional()
  }
);

registerTool(
  "get_context_graph",
  "Return a bounded derived context graph from SQLite SPDD metadata (snapshot or anchored neighborhood with filters and ordering — not LightRAG retrieval).",
  {
    project_id: z.string().optional(),
    include_stale: z.boolean().optional(),
    limit: z.number().optional(),
    types: z.array(z.string()).optional(),
    mode: z.enum(["snapshot", "anchored"]).optional(),
    root_type: z.enum(["run", "artifact", "source_path", "stable_id", "feature"]).optional(),
    root_id: z.string().optional(),
    depth: z.number().optional(),
    edge_types: z.array(z.string()).optional(),
    status: z.array(z.string()).optional(),
    relation: z.array(z.string()).optional(),
    ordering: z.enum(["default", "newest_runs_first", "unresolved_first", "stable_id_anchored_first"]).optional(),
    run_id: z.string().optional(),
    artifact_path: z.string().optional(),
    source_path: z.string().optional(),
    stable_id: z.string().optional(),
    feature_ref: z.string().optional()
  }
);

registerTool("remember_implementation_summary", "Store a completed implementation summary in temporal memory.", {
  project_id: z.string().optional(),
  id: z.string().optional(),
  topic: z.string(),
  summary: z.string(),
  related_requirements: z.array(z.string()).optional(),
  related_tasks: z.array(z.string()).optional(),
  related_files: z.array(z.string()).optional(),
  status: z.string().optional()
});

registerTool("ingest_changed_files", "Index changed files for a project workspace.", {
  project_id: z.string().optional(),
  paths: z.array(z.string()).optional(),
  confirmed: z.boolean().optional()
});

registerTool("ingest_document", "Index a specific document or source file.", {
  project_id: z.string().optional(),
  path: z.string()
});

registerTool("get_ingestion_status", "Return current and recent ingestion status.", {
  project_id: z.string().optional(),
  job_id: z.string().optional()
});

registerTool("validate_ids", "Validate stable IDs and return duplicate or missing ID warnings.", {
  project_id: z.string().optional()
});

registerTool(
  "list_stable_ids",
  "List occupied stable IDs from the project ID Registry with optional filters. Read-only: reports existing registry rows only and does not reserve or allocate IDs.",
  {
    project_id: z.string().optional(),
    category: z.enum(["REQ", "TASK", "ADR", "DEC", "REQCHG", "REV", "IMPL", "AC", "NFR", "DP"]).optional(),
    domain: z.string().optional(),
    source_path: z.string().optional(),
    status: z.enum(["current", "stale", "duplicate"]).optional(),
    include_stale: z.boolean().optional(),
    include_aliases: z.boolean().optional(),
    limit: z.number().optional()
  }
);

registerTool("sync_spdd_artifacts", "Scan spdd/prompt, analysis, plan, and review trees and sync metadata-backed artifact catalog rows.", {
  project_id: z.string().optional()
});

registerTool("record_spdd_run", "Record an SPDD work run with explicit trace links to stable IDs, paths, chunks, and labels.", {
  project_id: z.string().optional(),
  artifact_id: z.string().optional(),
  artifact_path: z.string().optional(),
  title: z.string().optional(),
  summary: z.string(),
  status: z.enum(["planned", "in_progress", "completed", "reverted", "superseded"]).optional(),
  actor: z.string().optional(),
  channel: z.string().optional(),
  stable_ids: z.array(z.string()).optional(),
  source_paths: z.array(z.string()).optional(),
  chunk_ids: z.array(z.string()).optional(),
  feature_refs: z.array(z.string()).optional(),
  tool_call_ids: z.array(z.string()).optional(),
  memory_event_ids: z.array(z.string()).optional(),
  relation: z.enum(["retrieved", "referenced", "implemented", "changed", "reviewed", "validated", "summarized"]).optional(),
  mirror_to_memory: z.boolean().optional()
});

registerTool("list_spdd_trace", "Return artifacts, runs, and trace links with optional filters (limit clamped server-side).", {
  project_id: z.string().optional(),
  run_id: z.string().optional(),
  artifact_id: z.string().optional(),
  artifact_path: z.string().optional(),
  stable_id: z.string().optional(),
  source_path: z.string().optional(),
  chunk_id: z.string().optional(),
  feature_ref: z.string().optional(),
  artifact_type: z.enum(["prompt", "analysis", "plan", "review", "unknown"]).optional(),
  target_type: z.enum(["stable_id", "source_path", "chunk", "feature", "tool_call", "memory_event"]).optional(),
  target_id: z.string().optional(),
  include_stale: z.boolean().optional(),
  limit: z.number().optional()
});

registerTool("lookup_spdd_trace", "Reverse lookup SPDD trace rows using stable IDs, paths, chunk IDs, feature refs, or typed targets.", {
  project_id: z.string().optional(),
  stable_id: z.string().optional(),
  source_path: z.string().optional(),
  chunk_id: z.string().optional(),
  feature_ref: z.string().optional(),
  target_type: z.enum(["stable_id", "source_path", "chunk", "feature", "tool_call", "memory_event"]).optional(),
  target_id: z.string().optional(),
  include_stale: z.boolean().optional(),
  limit: z.number().optional()
});

function registerTool(name: string, description: string, inputSchema: Record<string, z.ZodType>) {
  server.registerTool(name, { description, inputSchema }, async (input) => {
    const handler = handlers[name];
    const result = await handler(input as Record<string, unknown>);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ],
      structuredContent: result as Record<string, unknown>
    };
  });
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Project Context Platform MCP server running on stdio");
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
