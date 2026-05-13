import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("structured error payload keeps required fields", () => {
  const source = readFileSync(new URL("../packages/core/src/errors/platform-error.ts", import.meta.url), "utf8");
  for (const field of ["code", "message", "details", "project_id", "retryable"]) {
    assert.match(source, new RegExp(`${field}:`));
  }
});

test("backend HTTP contract documents LightRAG, Graphiti, and local fallback", () => {
  const contract = readFileSync(new URL("../docs/contracts/backend-http-v1.md", import.meta.url), "utf8");
  assert.match(contract, /LightRAG/);
  assert.match(contract, /Graphiti/);
  assert.match(contract, /PCP_ADAPTER_MODE=local/);
  assert.match(contract, /x-project-id/);
});

test("project catalog defaults to root catalog and de-dupes by project id", () => {
  const source = readFileSync(new URL("../packages/core/src/config/project-catalog-store.ts", import.meta.url), "utf8");
  assert.match(source, /PCP_PROJECT_CATALOG_PATH \?\? "project-catalog\.json"/);
  assert.match(source, /findIndex\(\(item\) => item\.project_id === next\.project_id\)/);
  assert.match(source, /current\.projects\[index\] = \{ \.\.\.current\.projects\[index\], \.\.\.next \}/);
  assert.match(source, /Project root does not exist\./);
  assert.match(source, /Project registry does not exist\./);
});

test("legacy ADR extraction creates canonical IDs and aliases", () => {
  const source = readFileSync(new URL("../packages/core/src/services/id-registry-service.ts", import.meta.url), "utf8");
  assert.match(source, /LEGACY_ADR_HEADING_PATTERN/);
  assert.match(source, /LEGACY_ADR_FILE_PATTERN/);
  assert.match(source, /LEGACY_USE_CASE_PATTERN/);
  assert.match(source, /LEGACY_PLAN_ITEM_PATTERN/);
  assert.match(source, /ADR-\$\{domain\}-\$\{padded\}/);
  assert.match(source, /REQ", lines/);
  assert.match(source, /TASK", lines/);
  assert.match(source, /aliases: Array\.from\(new Set\(aliases\)\)/);
  assert.match(source, /mergeExtractedEntries\(entries\)/);
});

test("ingestion indexes aliases alongside canonical stable IDs", () => {
  const source = readFileSync(new URL("../packages/core/src/services/ingestion-service.ts", import.meta.url), "utf8");
  assert.match(source, /extractIdsFromMarkdown\(content, path, config\.ids\)/);
  assert.match(source, /entry\.stable_id, \.\.\.\(entry\.aliases \?\? \[\]\)/);
});

test("MCP exposes documentation guidance and memory-first changelog policy", () => {
  const server = readFileSync(new URL("../packages/mcp-server/src/server.ts", import.meta.url), "utf8");
  const handlers = readFileSync(new URL("../packages/mcp-server/src/register-all-tools.ts", import.meta.url), "utf8");
  const guidelines = readFileSync(new URL("../docs/project-documentation-guidelines.md", import.meta.url), "utf8");
  assert.match(server, /get_documentation_guidelines/);
  assert.match(handlers, /getDocumentationGuidelines/);
  assert.match(guidelines, /Do not create Markdown changelogs by default/);
  assert.match(guidelines, /remember_implementation_summary/);
});

test("project deletion surfaces CLI, API route, SQLite deletes, and sidecar DELETE contracts", () => {
  const cli = readFileSync(new URL("../packages/cli/src/index.ts", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../packages/api/src/routes.ts", import.meta.url), "utf8");
  const sqlite = readFileSync(new URL("../packages/infra/src/sqlite-metadata-repository.ts", import.meta.url), "utf8");
  const registry = readFileSync(new URL("../packages/core/src/config/global-registry-store.ts", import.meta.url), "utf8");
  const catalog = readFileSync(new URL("../packages/core/src/config/project-catalog-store.ts", import.meta.url), "utf8");
  const lightrag = readFileSync(new URL("../services/lightrag/app.py", import.meta.url), "utf8");
  const graphiti = readFileSync(new URL("../services/graphiti/app.py", import.meta.url), "utf8");
  assert.match(cli, /action === "delete"/);
  assert.match(cli, /deleteProjectContextDir/);
  assert.match(routes, /app\.delete\("\/api\/projects\/:project_id"/);
  assert.match(sqlite, /DELETE FROM ingestion_jobs WHERE project_id/);
  assert.match(registry, /remove\(project_id/);
  assert.match(catalog, /remove\(project_id/);
  assert.match(lightrag, /@app\.delete\("\/v1\/projects\/\{project_id\}"\)/);
  assert.match(graphiti, /@app\.delete\("\/v1\/projects\/\{project_id\}"\)/);
  assert.match(graphiti, /delete_neo4j_namespace/);
});
