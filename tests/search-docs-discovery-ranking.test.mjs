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

async function loadBundled(entry) {
  const outdir = join(tmpdir(), "pcp-search-discovery-tests");
  mkdirSync(outdir, { recursive: true });
  const outfile = join(outdir, `${entry.replace(/\//g, "-")}-${Date.now()}.mjs`);
  buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent"
  });
  return import(pathToFileURL(outfile).href);
}

test("applySourceDiversityCap limits chunks per source_path then backfills", async () => {
  const { applySourceDiversityCap } = await loadBundled("packages/core/src/retrieval/manifest-search-ranking.ts");
  const ranked = [
    { source_path: "AGENTS.md", id: "a1" },
    { source_path: "AGENTS.md", id: "a2" },
    { source_path: "AGENTS.md", id: "a3" },
    { source_path: "packages/core/src/services/ingestion-service.ts", id: "b1" },
    { source_path: "docs/handover.md", id: "c1" }
  ];
  const out = applySourceDiversityCap(ranked, 4, 2);
  assert.equal(out.length, 4);
  assert.ok(out.some((row) => row.source_path.includes("ingestion-service")));
  const agentsCount = out.filter((row) => row.source_path === "AGENTS.md").length;
  assert.ok(agentsCount <= 2);
});

test("scoreManifestChunk weights source_path matches above content-only partial matches", async () => {
  const { scoreManifestChunk } = await loadBundled("packages/core/src/retrieval/manifest-search-ranking.ts");
  const pathHit = {
    source_path: "packages/core/src/services/ingestion-service.ts",
    heading: undefined,
    stable_ids: [],
    content: "path: packages/core/src/services/ingestion-service.ts\nprimary_symbol: IngestionService",
    chunk_index: 0,
    line_start: 1,
    chunk_id: "code-chunk"
  };
  const contentOnly = {
    source_path: "AGENTS.md",
    heading: "Rules",
    stable_ids: [],
    content: "mention ingestion in prose without service path",
    chunk_index: 0,
    line_start: 1,
    chunk_id: "doc-chunk"
  };
  const pathScore = scoreManifestChunk(pathHit, ["ingestion", "service"]);
  const contentScore = scoreManifestChunk(contentOnly, ["ingestion", "service"]);
  assert.ok(pathScore > contentScore);
});

test("buildSourceFileSummary adds basename path_tokens and primary_symbol fallback", async () => {
  const { buildSourceFileSummary, derivePrimarySymbol } = await loadBundled(
    "packages/core/src/services/ingestion-chunking/source-file-summary.ts"
  );
  assert.equal(derivePrimarySymbol("packages/core/src/services/ingestion-service.ts", []), "IngestionService");
  const summary = buildSourceFileSummary({
    path: "packages/core/src/services/ingestion-service.ts",
    stable_ids: [],
    chunk_id: "abc",
    chunk_kind: "file",
    line_count: 250,
    source_hash: "deadbeef",
    document_type: "code",
    language: "typescript",
    symbols: []
  });
  assert.match(summary, /basename: ingestion-service\.ts/);
  assert.match(summary, /path_tokens: .*ingestion/);
  assert.match(summary, /primary_symbol: IngestionService/);
});

test("FileLevelChunkingStrategy still excludes full TypeScript bodies after summary enrichment", async () => {
  const outdir = join(tmpdir(), "pcp-search-discovery-tests");
  mkdirSync(outdir, { recursive: true });
  const outfile = join(outdir, `file-level-${Date.now()}.mjs`);
  buildSync({
    entryPoints: ["packages/core/src/services/ingestion-chunking/file-level-chunking-strategy.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent"
  });
  const { FileLevelChunkingStrategy } = await import(pathToFileURL(outfile).href);
  const tsSource = `export function secretImpl(): string {
  return "UNIQUE_BODY_MARKER_XYZ9_SECRET_IMPL";
}
`;
  const chunks = new FileLevelChunkingStrategy().chunk({
    project_id: "pcp",
    path: "packages/core/src/services/ingestion-service.ts",
    content: tsSource,
    idEntries: [],
    stable_ids: [],
    indexing: { include: ["**/*"], ignore: [], max_chunks_per_section: 50, duplicate_id_policy: "warn" }
  });
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].content.includes("basename: ingestion-service.ts"));
  assert.ok(!chunks[0].content.includes("UNIQUE_BODY_MARKER_XYZ9_SECRET_IMPL"));
  assert.equal(chunks[0].content_hash, sha256Utf8(chunks[0].content));
});
