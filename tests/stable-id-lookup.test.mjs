import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("IdRegistryService implements project-scoped listStableIds with filtering hooks", () => {
  const source = readFileSync(new URL("../packages/core/src/services/id-registry-service.ts", import.meta.url), "utf8");
  assert.match(source, /async listStableIds\(/);
  assert.match(source, /listRegistryEntries\(pid\)/);
  assert.match(source, /include_stale/);
  assert.match(source, /compareRegistryEntriesForLookup/);
  assert.match(source, /clampStableIdLookupLimit/);
  assert.match(source, /duplicateStableIdWarnings/);
});

test("domain types declare StableIdLookupFilter and StableIdLookupResponse", () => {
  const types = readFileSync(new URL("../packages/core/src/domain/types.ts", import.meta.url), "utf8");
  assert.match(types, /export interface StableIdLookupFilter/);
  assert.match(types, /export interface StableIdLookupResponse/);
});

test("MCP registers read-only list_stable_ids alongside validate_ids", () => {
  const server = readFileSync(new URL("../packages/mcp-server/src/server.ts", import.meta.url), "utf8");
  const handlers = readFileSync(new URL("../packages/mcp-server/src/register-all-tools.ts", import.meta.url), "utf8");
  assert.match(server, /registerTool\(\s*"list_stable_ids"/);
  assert.match(server, /does not reserve or allocate IDs/);
  assert.match(handlers, /list_stable_ids:/);
  assert.match(handlers, /services\.ids\.listStableIds/);
  assert.match(handlers, /stableIdLookupFilters/);
});

test("documentation guidance surfaces stable ID lookup tool recommendation", () => {
  const guidance = readFileSync(new URL("../packages/mcp-server/src/documentation-guidelines.ts", import.meta.url), "utf8");
  const docsMd = readFileSync(new URL("../docs/project-documentation-guidelines.md", import.meta.url), "utf8");
  assert.match(guidance, /lookup_tool:/);
  assert.match(guidance, /list_stable_ids/);
  assert.match(docsMd, /list_stable_ids/);
});
