import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

async function loadMarkdownStrategy() {
  const outdir = join(tmpdir(), "pcp-granular-markdown-tests");
  mkdirSync(outdir, { recursive: true });
  const outfile = join(outdir, `markdown-chunking-strategy-${Date.now()}.mjs`);
  buildSync({
    entryPoints: ["packages/core/src/services/ingestion-chunking/markdown-chunking-strategy.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent"
  });
  return import(pathToFileURL(outfile).href);
}

const indexing = {
  include: ["**/*"],
  ignore: [],
  max_chunks_per_section: 50,
  duplicate_id_policy: "warn"
};

function id(stable_id, line_start) {
  return {
    project_id: "pcp",
    stable_id,
    category: "REQ",
    domain: "MCP",
    source_path: "docs/spec.md",
    line_start,
    line_end: line_start,
    status: "current",
    first_seen_at: "2026-05-15T00:00:00.000Z",
    last_seen_at: "2026-05-15T00:00:00.000Z"
  };
}

test("MarkdownChunkingStrategy emits exact table-row chunks with only header, separator, and matched row", async () => {
  const { MarkdownChunkingStrategy } = await loadMarkdownStrategy();
  const content = [
    "# API Requirements",
    "",
    "| ID | Responsibility |",
    "|---|---|",
    "| REQ-MCP-001 | The MCP server shall expose LightRAG-backed retrieval tools. |",
    "| REQ-MCP-002 | The MCP server shall expose Graphiti-backed memory tools. |",
    "",
    "After table context."
  ].join("\n");

  const chunks = new MarkdownChunkingStrategy().chunk({
    project_id: "pcp",
    path: "docs/spec.md",
    content,
    idEntries: [id("REQ-MCP-001", 5), id("REQ-MCP-002", 6)],
    heading: "API Requirements",
    stable_ids: ["REQ-MCP-001", "REQ-MCP-002"],
    indexing
  });

  const row1 = chunks.find((chunk) => chunk.stable_ids?.includes("REQ-MCP-001"));
  const row2 = chunks.find((chunk) => chunk.stable_ids?.includes("REQ-MCP-002"));

  assert.equal(row1?.chunk_kind, "markdown_table_row");
  assert.equal(row2?.chunk_kind, "markdown_table_row");
  assert.deepEqual(row1?.stable_ids, ["REQ-MCP-001"]);
  assert.deepEqual(row2?.stable_ids, ["REQ-MCP-002"]);

  assert.match(row1.content, /\| ID \| Responsibility \|/);
  assert.match(row1.content, /\|---\|---\|/);
  assert.match(row1.content, /REQ-MCP-001/);
  assert.doesNotMatch(row1.content, /REQ-MCP-002/);

  assert.match(row2.content, /\| ID \| Responsibility \|/);
  assert.match(row2.content, /\|---\|---\|/);
  assert.match(row2.content, /REQ-MCP-002/);
  assert.doesNotMatch(row2.content, /REQ-MCP-001/);
  assert.equal(row2.line_start, 3);
  assert.equal(row2.line_end, 6);
});

test("MarkdownChunkingStrategy leaves non-table stable IDs as stable-id anchor chunks", async () => {
  const { MarkdownChunkingStrategy } = await loadMarkdownStrategy();
  const content = [
    "# API Requirements",
    "",
    "REQ-MCP-003 requires focused paragraph anchoring.",
    "",
    "Unrelated context."
  ].join("\n");

  const chunks = new MarkdownChunkingStrategy().chunk({
    project_id: "pcp",
    path: "docs/spec.md",
    content,
    idEntries: [id("REQ-MCP-003", 3)],
    heading: "API Requirements",
    stable_ids: ["REQ-MCP-003"],
    indexing
  });

  const anchor = chunks.find((chunk) => chunk.stable_ids?.includes("REQ-MCP-003"));
  assert.equal(anchor?.chunk_kind, "stable_id_anchor");
  assert.match(anchor.content, /REQ-MCP-003 requires focused paragraph anchoring/);
});
