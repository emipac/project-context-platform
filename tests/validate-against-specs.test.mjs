import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("validateAgainstSpecs uses metadata and observability alongside staged exact resolution", () => {
  const composer = readFileSync(new URL("../packages/core/src/services/context-composer-service.ts", import.meta.url), "utf8");
  assert.match(composer, /private readonly metadata: MetadataRepository/u);
  assert.match(composer, /private readonly observability: ContextObservabilityService/u);
  assert.match(composer, /async validateAgainstSpecs/u);
  assert.match(composer, /requirement_unresolved/u);
  assert.match(composer, /missing_evidence/u);
  assert.match(composer, /freshnessSignalsToFindings/u);
  assert.match(composer, /memory_deprecated_overlap/u);
});

test("spec validation pipeline exposes text cap and confidence helpers", () => {
  const src = readFileSync(new URL("../packages/core/src/services/spec-validation-pipeline.ts", import.meta.url), "utf8");
  assert.match(src, /VALIDATION_TEXT_CAP/u);
  assert.match(src, /computeValidationConfidence/u);
  assert.match(src, /normalizeValidateAgainstSpecsInput/u);
});

test("domain types define validate_against_specs DTOs", () => {
  const types = readFileSync(new URL("../packages/core/src/domain/types.ts", import.meta.url), "utf8");
  assert.match(types, /ValidateAgainstSpecsInput/u);
  assert.match(types, /ValidateAgainstSpecsResult/u);
  assert.match(types, /ValidationFinding/u);
});

test("REST validate route accepts artifact_path changed_files source_paths and mode", () => {
  const routes = readFileSync(new URL("../packages/api/src/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /artifact_path: z\.string\(\)\.optional\(\)/u);
  assert.match(routes, /changed_files: z\.array\(z\.string\(\)\)\.optional\(\)/u);
  assert.match(routes, /source_paths: z\.array\(z\.string\(\)\)\.optional\(\)/u);
  assert.match(routes, /mode: z\.enum\(\["fast", "strict"\]\)\.optional\(\)/u);
});

test("MCP validate_against_specs forwards extended fields", () => {
  const server = readFileSync(new URL("../packages/mcp-server/src/server.ts", import.meta.url), "utf8");
  const handlers = readFileSync(new URL("../packages/mcp-server/src/register-all-tools.ts", import.meta.url), "utf8");
  assert.match(server, /artifact_path/u);
  assert.match(server, /changed_files/u);
  assert.match(server, /source_paths/u);
  assert.match(server, /mode: z\.enum\(\["fast", "strict"\]\)/u);
  assert.match(handlers, /artifact_path/u);
  assert.match(handlers, /changed_files/u);
  assert.match(handlers, /source_paths/u);
  assert.match(handlers, /mode: input\.mode as "fast" \| "strict"/u);
});

test("app services wires composer with repository and context observability", () => {
  const app = readFileSync(new URL("../packages/infra/src/app-services.ts", import.meta.url), "utf8");
  assert.match(app, /new ContextComposerService\(workspaces, lightrag, graphiti, repository, contextObservability\)/u);
});
