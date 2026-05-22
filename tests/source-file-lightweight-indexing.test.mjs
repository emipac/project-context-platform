import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

function sha256Utf8(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

async function loadFileLevelStrategy() {
  const outdir = join(tmpdir(), "pcp-source-summary-tests");
  mkdirSync(outdir, { recursive: true });
  const outfile = join(outdir, `file-level-chunking-strategy-${Date.now()}.mjs`);
  buildSync({
    entryPoints: ["packages/core/src/services/ingestion-chunking/file-level-chunking-strategy.ts"],
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

test("FileLevelChunkingStrategy indexes TypeScript as bounded summary, not full source", async () => {
  const { FileLevelChunkingStrategy } = await loadFileLevelStrategy();
  const tsSource = `// REQ-TEST-SFLI-001 in comment
export function visibleFn(): string {
  const secret = "UNIQUE_BODY_MARKER_XYZ9_SECRET_IMPL";
  return secret;
}
`;
  const chunks = new FileLevelChunkingStrategy().chunk({
    project_id: "pcp",
    path: "packages/demo/widget.ts",
    content: tsSource,
    idEntries: [],
    stable_ids: ["REQ-TEST-SFLI-001"],
    indexing
  });

  assert.equal(chunks.length, 1);
  const c = chunks[0];
  assert.equal(c.chunk_kind, "file");
  assert.ok(c.content.includes("path: packages/demo/widget.ts"));
  assert.ok(c.content.includes("language: typescript"));
  assert.ok(c.content.includes("stable_ids: REQ-TEST-SFLI-001"));
  assert.ok(c.content.includes("visibleFn"));
  assert.equal(c.content_hash, sha256Utf8(c.content));
  assert.notEqual(c.content_hash, sha256Utf8(tsSource.replace(/\r\n/g, "\n")));
  assert.match(c.content, /source_hash: [a-f0-9]{64}/);
  assert.equal(c.stable_ids?.length, 1);
  assert.equal(c.stable_ids?.[0], "REQ-TEST-SFLI-001");
  assert.ok(!c.content.includes("UNIQUE_BODY_MARKER_XYZ9_SECRET_IMPL"));
});

test("FileLevelChunkingStrategy summarizes JSON without embedding raw payload", async () => {
  const { FileLevelChunkingStrategy } = await loadFileLevelStrategy();
  const raw = '{"deep":{"nested":"DO_NOT_EMBED_THIS_VALUE"}}';
  const chunks = new FileLevelChunkingStrategy().chunk({
    project_id: "pcp",
    path: "config/settings.json",
    content: raw,
    idEntries: [],
    stable_ids: [],
    indexing
  });
  assert.equal(chunks.length, 1);
  const c = chunks[0];
  assert.ok(c.content.includes("language: json"));
  assert.ok(!c.content.includes("DO_NOT_EMBED_THIS_VALUE"));
  assert.equal(c.content_hash, sha256Utf8(c.content));
});
