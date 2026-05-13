import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PlatformError } from "../errors/platform-error.js";
import type { ProjectConfig } from "../domain/types.js";

const configSchema = z.object({
  indexing: z.object({
    include: z.array(z.string()).default(["docs/**", "src/**", "tests/**", "*.md"]),
    ignore: z.array(z.string()).default([".git/**", "node_modules/**", ".env", ".env.*"]),
    max_chunks_per_section: z.number().int().positive().default(8),
    duplicate_id_policy: z.enum(["warn", "fail"]).default("warn")
  }).default({}),
  ids: z.object({
    required_prefixes: z.array(z.string()).default(["REQ", "TASK", "ADR", "DEC", "REQCHG", "REV", "IMPL", "AC", "NFR", "DP"]),
    project_domain: z.string().optional(),
    legacy_patterns: z.object({
      adr_headings: z.boolean().default(true),
      adr_filenames: z.boolean().default(true),
      use_cases: z.boolean().default(false),
      plan_items: z.boolean().default(false)
    }).default({})
  }).default({}),
  lightrag: z.object({
    index_path: z.string().default(".project-context/lightrag"),
    timeout_ms: z.number().int().positive().default(5000),
    base_url: z.string().url().default(process.env.LIGHTRAG_BASE_URL ?? "http://127.0.0.1:9621"),
    health_path: z.string().default("/health")
  }).default({}),
  graphiti: z.object({
    namespace: z.string().optional(),
    timeout_ms: z.number().int().positive().default(5000),
    base_url: z.string().url().default(process.env.GRAPHITI_BASE_URL ?? "http://127.0.0.1:8091"),
    health_path: z.string().default("/health")
  }).default({}),
  memory: z.object({
    high_risk_types: z.array(z.string()).default(["requirement_change", "review_finding"]),
    low_risk_types: z.array(z.string()).default(["decision", "implementation_summary"])
  }).default({}),
  api: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().positive().default(4318),
    auth_token: z.string().optional()
  }).default({}),
  ui: z.object({
    enabled: z.boolean().default(true)
  }).default({})
});

const defaultConfig = configSchema.parse({});

export function loadProjectConfig(repoRoot: string): ProjectConfig {
  const configPath = join(repoRoot, ".project-context", "config.yml");
  if (!existsSync(configPath)) {
    const projectDomain = normalizeProjectDomain(projectIdFromRoot(repoRoot));
    return {
      ...defaultConfig,
      ids: { ...defaultConfig.ids, project_domain: projectDomain },
      graphiti: { ...defaultConfig.graphiti, namespace: projectIdFromRoot(repoRoot) }
    };
  }

  const raw = readFileSync(configPath, "utf8");
  const parsed = parseSimpleYaml(raw);
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new PlatformError("CONFIG_INVALID", "Project configuration is invalid.", {
      details: { issues: result.error.issues.map((issue) => issue.message) }
    });
  }
  const projectDomain = normalizeProjectDomain(result.data.ids.project_domain ?? projectIdFromRoot(repoRoot));
  return {
    ...result.data,
    ids: {
      ...result.data.ids,
      project_domain: projectDomain
    },
    graphiti: {
      ...result.data.graphiti,
      namespace: result.data.graphiti.namespace ?? projectIdFromRoot(repoRoot)
    }
  };
}

export function defaultProjectConfig(project_id: string): ProjectConfig {
  return {
    ...defaultConfig,
    ids: { ...defaultConfig.ids, project_domain: normalizeProjectDomain(project_id) },
    graphiti: { ...defaultConfig.graphiti, namespace: project_id }
  };
}

function projectIdFromRoot(repoRoot: string): string {
  return repoRoot.split(/[\\/]/).filter(Boolean).at(-1)?.replace(/[^a-zA-Z0-9_-]/g, "-") ?? "project";
}

function normalizeProjectDomain(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "") || "LOCAL";
}

function parseSimpleYaml(raw: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: Record<string, unknown> }> = [{ indent: -1, value: root }];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const [keyPart, ...valueParts] = line.trim().split(":");
    const key = keyPart.trim();
    const rawValue = valueParts.join(":").trim();
    while (stack.at(-1) && indent <= stack.at(-1)!.indent) stack.pop();
    const parent = stack.at(-1)!.value;
    if (!rawValue) {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, value: child });
      continue;
    }
    parent[key] = parseScalar(rawValue);
  }
  return root;
}

function parseScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1).split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  return value.replace(/^["']|["']$/g, "");
}
