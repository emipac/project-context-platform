import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("MetadataRepository declares SPDD trace persistence methods", () => {
  const adapters = readFileSync(new URL("../packages/core/src/ports/adapters.ts", import.meta.url), "utf8");
  for (const sig of [
    "saveSpddArtifacts",
    "listSpddArtifacts",
    "saveSpddWorkRun",
    "listSpddWorkRuns",
    "saveSpddTraceLinks",
    "listSpddTraceLinks"
  ]) {
    assert.match(adapters, new RegExp(`${sig}\\(`));
  }
});

test("SQLite metadata repository provisions SPDD trace tables and deletes them with projects", () => {
  const sqlite = readFileSync(new URL("../packages/infra/src/sqlite-metadata-repository.ts", import.meta.url), "utf8");
  assert.match(sqlite, /CREATE TABLE IF NOT EXISTS spdd_artifacts/);
  assert.match(sqlite, /CREATE TABLE IF NOT EXISTS spdd_work_runs/);
  assert.match(sqlite, /CREATE TABLE IF NOT EXISTS spdd_trace_links/);
  assert.match(sqlite, /DELETE FROM spdd_artifacts WHERE project_id/);
  assert.match(sqlite, /DELETE FROM spdd_work_runs WHERE project_id/);
  assert.match(sqlite, /DELETE FROM spdd_trace_links WHERE project_id/);
});

test("JSON metadata repository initializes SPDD arrays for legacy files", () => {
  const jsonRepo = readFileSync(new URL("../packages/infra/src/json-metadata-repository.ts", import.meta.url), "utf8");
  assert.match(jsonRepo, /spddArtifacts:/);
  assert.match(jsonRepo, /parsed\.spddArtifacts \?\? \[\]/);
});

test("Project metadata repository forwards SPDD repository calls", () => {
  const projRepo = readFileSync(new URL("../packages/infra/src/project-metadata-repository.ts", import.meta.url), "utf8");
  assert.match(projRepo, /saveSpddArtifacts/);
  assert.match(projRepo, /listSpddTraceLinks/);
});

test("SpddTraceService scans structured SPDD directories only", () => {
  const svc = readFileSync(new URL("../packages/core/src/services/spdd-trace-service.ts", import.meta.url), "utf8");
  assert.match(svc, /spdd\/prompt/);
  assert.match(svc, /collectSpddMarkdownFiles/);
});

test("REST exposes SPDD trace routes", () => {
  const routes = readFileSync(new URL("../packages/api/src/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /spdd-trace\/artifacts\/sync/);
  assert.match(routes, /spdd-trace\/lookup/);
});

test("MCP registers SPDD trace tools", () => {
  const server = readFileSync(new URL("../packages/mcp-server/src/server.ts", import.meta.url), "utf8");
  const handlers = readFileSync(new URL("../packages/mcp-server/src/register-all-tools.ts", import.meta.url), "utf8");
  assert.match(server, /sync_spdd_artifacts/);
  assert.match(server, /lookup_spdd_trace/);
  assert.match(handlers, /services\.spddTrace\.syncArtifacts/);
});

test("CLI exposes spdd-trace subcommands", () => {
  const cli = readFileSync(new URL("../packages/cli/src/index.ts", import.meta.url), "utf8");
  assert.match(cli, /command\("spdd-trace"\)/);
  assert.match(cli, /spddTrace\.syncArtifacts/);
});

test("Web UI declares SPDD Trace tab", () => {
  const tabs = readFileSync(new URL("../packages/web/src/tabs.ts", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../packages/web/src/main.tsx", import.meta.url), "utf8");
  assert.match(tabs, /SPDD Trace/);
  assert.match(ui, /SpddTracePanel/);
  assert.match(ui, /spdd-trace\/runs/);
});
