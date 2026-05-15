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

test("REST exposes context observability routes and documents include_stale query", () => {
  const routes = readFileSync(new URL("../packages/api/src/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /\/context\/freshness/);
  assert.match(routes, /\/context\/quality/);
  assert.match(routes, /\/context\/graph/);
  assert.match(routes, /include_stale === "true"\)/);
});

test("MCP registers context observability tools", () => {
  const server = readFileSync(new URL("../packages/mcp-server/src/server.ts", import.meta.url), "utf8");
  const handlers = readFileSync(new URL("../packages/mcp-server/src/register-all-tools.ts", import.meta.url), "utf8");
  assert.match(server, /registerTool\(\s*"get_context_freshness"/);
  assert.match(server, /registerTool\(\s*"get_context_quality_metrics"/);
  assert.match(server, /registerTool\(\s*"get_context_graph"/);
  assert.match(handlers, /get_context_freshness:/);
  assert.match(handlers, /services\.contextObservability\.getFreshnessReport/);
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
  assert.match(tabs, /contextHealth/);
  assert.match(main, /ContextFreshnessPanel/);
  assert.match(main, /includeStaleDocs/);
});
