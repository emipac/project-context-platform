import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchRequestBody, DEFAULT_SEARCH_FILTERS } from "../packages/web/src/search-request.ts";

test("buildSearchRequestBody maps UI filters to REST search budget fields", () => {
  const body = buildSearchRequestBody("lightrag ingestion", {
    ...DEFAULT_SEARCH_FILTERS,
    limit: 20,
    documentTypes: ["doc", "code"],
    chunkKinds: ["markdown_section"],
    sourcePathPrefixes: "packages/core/src/\ndocs/",
    queryMode: "hybrid",
    topK: "12",
    maxTotalTokens: "4000"
  });
  assert.equal(body.query, "lightrag ingestion");
  assert.equal(body.limit, 20);
  assert.deepEqual(body.document_types, ["doc", "code"]);
  assert.deepEqual(body.chunk_kinds, ["markdown_section"]);
  assert.deepEqual(body.source_path_prefixes, ["packages/core/src/", "docs/"]);
  assert.equal(body.query_mode, "hybrid");
  assert.equal(body.top_k, 12);
  assert.equal(body.max_total_tokens, 4000);
  assert.equal(body.chunk_top_k, undefined);
});

test("buildSearchRequestBody omits empty optional filters", () => {
  const body = buildSearchRequestBody("foo", DEFAULT_SEARCH_FILTERS);
  assert.deepEqual(body, { query: "foo", limit: 12 });
});
