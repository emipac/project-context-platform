import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("context composer stages cheap retrieval and deep mode uses parallel semantic dispatch", () => {
  const composer = readFileSync(new URL("../packages/core/src/services/context-composer-service.ts", import.meta.url), "utf8");
  assert.match(composer, /retrieval_mode \?\? "fast"/u);
  assert.match(composer, /Promise\.allSettled\(/u);
  assert.match(composer, /mode === "semantic"/u);
  assert.match(composer, /mode === "deep"/u);
  assert.match(composer, /Promise\.all\(\[/u);
});

test("staged pipeline uses naive query_mode for manifest discovery", () => {
  const pipeline = readFileSync(new URL("../packages/core/src/services/staged-retrieval-pipeline.ts", import.meta.url), "utf8");
  assert.match(pipeline, /query_mode: "naive"/u);
  assert.match(pipeline, /lightrag_semantic_timeout/u);
  assert.match(pipeline, /runScopedSemantic/u);
  assert.match(pipeline, /kind === "docs"/u);
  assert.match(pipeline, /getRelatedCode/u);
});

test("LightRAG HTTP adapter forwards search budget and strips transport-only fields from JSON body", () => {
  const adapter = readFileSync(new URL("../packages/infra/src/http/lightrag-http-adapter.ts", import.meta.url), "utf8");
  assert.match(adapter, /perCallFromBudget/u);
  assert.match(adapter, /timeout_ms/u);
  assert.match(adapter, /\/v1\/search/u);
});

test("JsonHttpClient accepts per-call timeout and retries overrides", () => {
  const client = readFileSync(new URL("../packages/infra/src/http/http-client.ts", import.meta.url), "utf8");
  assert.match(client, /PerCallHttpOptions/u);
  assert.match(client, /perCallOptions\?\.timeoutMs \?\? this\.options\.timeoutMs/u);
  assert.match(client, /perCallOptions\?\.retries \?\? this\.options\.retries/u);
});

test("MCP and REST expose prepare_feature_context retrieval_mode and scope hints", () => {
  const server = readFileSync(new URL("../packages/mcp-server/src/server.ts", import.meta.url), "utf8");
  const handlers = readFileSync(new URL("../packages/mcp-server/src/register-all-tools.ts", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../packages/api/src/routes.ts", import.meta.url), "utf8");
  for (const source of [server, handlers, routes]) {
    assert.match(source, /retrieval_mode/u);
    assert.match(source, /source_path_prefixes/u);
    assert.match(source, /chunk_kinds/u);
  }
});
