import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("ContextObservabilityService implements freshness, metrics, and graph builders", () => {
  const svc = readFileSync(new URL("../packages/core/src/services/context-observability-service.ts", import.meta.url), "utf8");
  assert.match(svc, /class ContextObservabilityService/);
  assert.match(svc, /getFreshnessReport\(/);
  assert.match(svc, /getQualityMetrics\(/);
  assert.match(svc, /getContextGraph\(/);
});

test("ContextObservabilityService treats unresolved source paths as informational", () => {
  const svc = readFileSync(new URL("../packages/core/src/services/context-observability-service.ts", import.meta.url), "utf8");
  assert.match(svc, /unresolvedAnchoredLinks/);
  assert.match(svc, /unresolvedSourcePathLinks/);
  assert.match(svc, /unresolved_source_path_trace_links/);
  assert.match(svc, /severity: "info"/);
});

test("REST exposes context observability routes and document index query parsing", () => {
  const routes = readFileSync(new URL("../packages/api/src/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /\/context\/freshness/);
  assert.match(routes, /\/context\/quality/);
  assert.match(routes, /\/context\/graph/);
  assert.match(routes, /\/storage\/health/);
  assert.match(routes, /services\.lightrag\.getHealth\(project_id\)/);
  assert.match(routes, /services\.lightrag\.getStorageHealth/);
  assert.match(routes, /Storage health project_id query must match the route project_id/);
  assert.match(routes, /documentIndexOptionsFromQuery/);
  assert.match(routes, /q\.include_stale === "true" \? "all"/);
});

test("MCP registers context observability tools", () => {
  const server = readFileSync(new URL("../packages/mcp-server/src/server.ts", import.meta.url), "utf8");
  const handlers = readFileSync(new URL("../packages/mcp-server/src/register-all-tools.ts", import.meta.url), "utf8");
  assert.match(server, /registerTool\(\s*"get_context_freshness"/);
  assert.match(server, /registerTool\(\s*"get_context_quality_metrics"/);
  assert.match(server, /registerTool\(\s*"get_context_graph"/);
  assert.match(server, /registerTool\(\s*"platform_runtime"/);
  assert.match(handlers, /get_context_freshness:/);
  assert.match(handlers, /services\.contextObservability\.getFreshnessReport/);
  assert.match(handlers, /platform_runtime:/);
  assert.match(handlers, /createRuntimeIdentity/);
});

test("MCP context graph uses shared core normalizers and validation errors", () => {
  const handlers = readFileSync(new URL("../packages/mcp-server/src/register-all-tools.ts", import.meta.url), "utf8");
  const params = readFileSync(new URL("../packages/core/src/context/context-graph-params.ts", import.meta.url), "utf8");
  assert.match(handlers, /normalizeContextGraphNodeType/);
  assert.match(params, /normalizeContextGraphNodeType/);
  assert.match(params, /artifact"\) return "spdd_artifact"/);
  assert.match(params, /run"\) return "spdd_run"/);
  assert.match(params, /feature"\) return "feature_ref"/);
  assert.match(handlers, /new PlatformError\("VALIDATION_ERROR", "Invalid graph node types\."/);
});

test("Context graph service supports anchored traversal and ordering", () => {
  const svc = readFileSync(new URL("../packages/core/src/services/context-observability-service.ts", import.meta.url), "utf8");
  assert.match(svc, /inferGraphAnchored/);
  assert.match(svc, /inducedNeighborhoodEdges/);
  assert.match(svc, /GRAPH_TRUNCATED_BY_LIMIT/);
  assert.match(svc, /GRAPH_ROOT_NOT_FOUND/);
});

test("REST context graph parses anchors via core helpers", () => {
  const routes = readFileSync(new URL("../packages/api/src/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /normalizeContextGraphRootType/);
  assert.match(routes, /splitCommaQuery/);
});

test("Web UI adds Context Health tab and stale toggles", () => {
  const tabs = readFileSync(new URL("../packages/web/src/tabs.ts", import.meta.url), "utf8");
  const main = readFileSync(new URL("../packages/web/src/main.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../packages/web/src/tabs/ContextFreshnessPanel.tsx", import.meta.url), "utf8");
  assert.match(tabs, /contextHealth/);
  assert.match(main, /ContextFreshnessPanel/);
  assert.match(main, /\/health\?project_id=/);
  assert.match(main, /includeStaleIds/);
  assert.match(main, /includeStaleSpdd/);
  assert.match(panel, /Check LightRAG storage/);
  assert.match(panel, /\/storage\/health\?deep=true/);
  assert.match(panel, /Corrupt JSON Files/);
  assert.match(panel, /reportedProjectId/);
});

test("Web UI document index prioritizes chunk metadata columns", () => {
  const main = readFileSync(new URL("../packages/web/src/main.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../packages/web/src/components/Panel.tsx", import.meta.url), "utf8");
  const table = readFileSync(new URL("../packages/web/src/components/Table.tsx", import.meta.url), "utf8");
  assert.match(main, /preferredKeys=\{\["source_path", "chunk_kind", "chunk_index"/);
  assert.match(main, /documentStatus/);
  assert.match(main, /documentChunkKind/);
  assert.match(main, /Newest first/);
  assert.match(main, /line_start", "updated_at", "content"/);
  assert.match(main, /maxColumns=\{9\}/);
  assert.match(panel, /preferredKeys\?: string\[\]/);
  assert.match(panel, /maxColumns\?: number/);
  assert.match(table, /preferredKeys = \[\]/);
  assert.match(table, /maxColumns = 8/);
});

test("Web UI memory tab prioritizes implementation summary fields", () => {
  const main = readFileSync(new URL("../packages/web/src/main.tsx", import.meta.url), "utf8");
  const formatters = readFileSync(new URL("../packages/web/src/formatters.tsx", import.meta.url), "utf8");
  assert.match(main, /title="Memory"/);
  assert.match(main, /preferredKeys=\{\["topic", "summary", "type", "status", "related_files"/);
  assert.match(main, /maxColumns=\{10\}/);
  assert.match(formatters, /related_files: "Related Files"/);
  assert.match(formatters, /graph_ingestion_status: "Graph Ingestion"/);
});

test("Settings tab can load project-scoped deep health JSON", () => {
  const main = readFileSync(new URL("../packages/web/src/main.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../packages/web/src/tabs/SettingsPanel.tsx", import.meta.url), "utf8");
  assert.match(main, /<SettingsPanel projectId=\{activeProject\}/);
  assert.match(settings, /Load deep health JSON/);
  assert.match(settings, /\/health\?project_id=/);
  assert.match(settings, /deep=true/);
  assert.match(settings, /Deep Health JSON/);
});
