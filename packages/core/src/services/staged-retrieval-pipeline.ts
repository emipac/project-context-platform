import type { CanonicalDocumentChunk, FeatureContextResponseDTO } from "../domain/types.js";
import type { LightRagAdapter, LightRagSearchBudget } from "../ports/adapters.js";
import { PlatformError } from "../errors/platform-error.js";

export type ManifestDiscoveryScope = {
  document_types?: string[];
  source_path_prefixes?: string[];
  chunk_kinds?: string[];
};

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "for",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "with",
  "is",
  "are",
  "be",
  "as",
  "at",
  "by",
  "from",
  "that",
  "this"
]);

export class StagedRetrievalPipeline {
  constructor(private readonly lightrag: LightRagAdapter) {}

  async resolveExactSources(project_id: string, requirement_ids?: string[]): Promise<CanonicalDocumentChunk[]> {
    if (!requirement_ids?.length) return [];
    const byId = new Map<string, CanonicalDocumentChunk>();
    for (const rid of requirement_ids) {
      const trimmed = rid.trim();
      if (!trimmed) continue;
      for (const c of await this.lightrag.getSpecContext(project_id, trimmed, false)) {
        byId.set(c.chunk_id, c);
      }
      for (const c of await this.lightrag.getRequirementSources(project_id, trimmed)) {
        byId.set(c.chunk_id, c);
      }
    }
    return [...byId.values()];
  }

  extractConcepts(feature_name: string, exactChunks: CanonicalDocumentChunk[]): string[] {
    const out: string[] = [];
    for (const c of exactChunks) {
      for (const id of c.stable_ids) {
        if (id && !out.includes(id)) out.push(id);
      }
    }
    for (const raw of feature_name.split(/\W+/)) {
      if (!raw) continue;
      const lower = raw.toLowerCase();
      if (lower.length < 2 || STOP_WORDS.has(lower)) continue;
      if (!out.includes(lower)) out.push(lower);
    }
    if (out.length < 3 && exactChunks[0]) {
      const sample = exactChunks[0].content.slice(0, 400);
      for (const t of termsFromText(sample)) {
        if (out.length >= 8) break;
        if (t.length < 2 || STOP_WORDS.has(t)) continue;
        if (!out.includes(t)) out.push(t);
      }
    }
    if (out.length === 0) {
      return termsFromText(feature_name).slice(0, 8);
    }
    return out.slice(0, 8);
  }

  async discoverManifestCandidates(project_id: string, featureQuery: string, scope: ManifestDiscoveryScope): Promise<CanonicalDocumentChunk[]> {
    return this.lightrag.searchDocs(project_id, featureQuery, {
      query_mode: "naive",
      limit: 24,
      document_types: scope.document_types,
      source_path_prefixes: scope.source_path_prefixes,
      chunk_kinds: scope.chunk_kinds
    });
  }

  async runScopedSemantic(
    project_id: string,
    query: string,
    budget: LightRagSearchBudget,
    kind: "docs" | "code"
  ): Promise<{ chunks: CanonicalDocumentChunk[]; warning?: string }> {
    try {
      if (kind === "docs") {
        const chunks = await this.lightrag.searchDocs(project_id, query, budget);
        return { chunks };
      }
      const chunks = await this.lightrag.getRelatedCode(project_id, query, budget);
      return { chunks };
    } catch (err) {
      return { chunks: [], warning: semanticWarningFromError(err) };
    }
  }

  mergeChunkLayers(exact: CanonicalDocumentChunk[], supplemental: CanonicalDocumentChunk[]): CanonicalDocumentChunk[] {
    const byId = new Map<string, CanonicalDocumentChunk>();
    for (const c of supplemental) {
      if (!byId.has(c.chunk_id)) byId.set(c.chunk_id, c);
    }
    for (const c of exact) {
      byId.set(c.chunk_id, c);
    }
    return [...byId.values()];
  }

  assembleFeatureResponse(params: {
    feature_name: string;
    merged_chunks: CanonicalDocumentChunk[];
    facts: Record<string, unknown>[];
    warnings: string[];
  }): FeatureContextResponseDTO {
    const docs = params.merged_chunks;
    return {
      feature: params.feature_name,
      relevant_prd_sections: docs.filter((item) => item.document_type === "prd"),
      relevant_srs_sections: docs.filter((item) => item.document_type === "srs" || item.source_path.toLowerCase().includes("srs")),
      related_adrs: docs.filter((item) => item.source_path.toLowerCase().includes("adr")),
      api_contracts: docs.filter((item) => item.content.includes("/api/")),
      database_context: docs.filter(
        (item) => item.content.toLowerCase().includes("sqlite") || item.content.toLowerCase().includes("neo4j")
      ),
      related_code: docs.filter(
        (item) =>
          item.document_type === "code" || /\.(ts|tsx|js|jsx|php|blade\.php)$/i.test(item.source_path)
      ),
      related_tests: docs.filter((item) => item.document_type === "test" || item.source_path.includes("test")),
      current_decisions: params.facts.filter((item) => item.status !== "deprecated"),
      deprecated_decisions: params.facts.filter((item) => item.status === "deprecated"),
      open_questions: [],
      known_review_findings: [],
      implementation_checklist: [],
      traceability: docs.flatMap((item) => item.stable_ids.map((stable_id) => ({ stable_id, source_path: item.source_path }))),
      warnings: params.warnings
    };
  }
}

function termsFromText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter(Boolean);
}

function semanticWarningFromError(err: unknown): string {
  if (err instanceof PlatformError && err.code === "BACKEND_UNAVAILABLE") {
    return "lightrag_semantic_timeout";
  }
  if (err instanceof PlatformError) {
    return `lightrag_semantic_failed:${err.code}`;
  }
  return "lightrag_semantic_failed:unknown";
}
