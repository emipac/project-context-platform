import { readFile } from "node:fs/promises";
import type {
  CanonicalDocumentChunk,
  ContextFreshnessReport,
  FeatureContextRequestDTO,
  FeatureContextResponseDTO,
  SpddArtifact,
  SpddTraceLink,
  ValidateAgainstSpecsInput,
  ValidateAgainstSpecsResult,
  ValidationConfidence,
  ValidationFinding
} from "../domain/types.js";
import type { GraphitiAdapter, LightRagAdapter, LightRagSearchBudget } from "../ports/adapters.js";
import type { MetadataRepository } from "../ports/adapters.js";
import { StagedRetrievalPipeline, type ManifestDiscoveryScope } from "./staged-retrieval-pipeline.js";
import { ProjectWorkspaceService } from "./project-workspace-service.js";
import { ContextObservabilityService } from "./context-observability-service.js";
import {
  capValidationText,
  computeValidationConfidence,
  extractStableIdLiterals,
  factLooksDeprecatedOrSuperseded,
  freshnessSignalsToFindings,
  normalizeRelativeValidationPath,
  normalizeValidateAgainstSpecsInput,
  resolvePathUnderWorkspaceRoot,
  sortFindingsBySeverity,
  stableIdsReferencedInFact
} from "./spec-validation-pipeline.js";

const SEMANTIC_BUDGET: LightRagSearchBudget = {
  query_mode: "local",
  top_k: 8,
  chunk_top_k: 4,
  max_total_tokens: 4000,
  timeout_ms: 15000,
  retries: 0,
  limit: 8
};

export class ContextComposerService {
  private readonly pipeline: StagedRetrievalPipeline;

  constructor(
    private readonly workspaces: ProjectWorkspaceService,
    private readonly lightrag: LightRagAdapter,
    private readonly graphiti: GraphitiAdapter,
    private readonly metadata: MetadataRepository,
    private readonly observability: ContextObservabilityService
  ) {
    this.pipeline = new StagedRetrievalPipeline(lightrag);
  }

  async prepareFeatureContext(project_id: string | undefined, input: FeatureContextRequestDTO): Promise<FeatureContextResponseDTO> {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    const mode = input.retrieval_mode ?? "fast";
    const warnings: string[] = [];

    const docsScope: ManifestDiscoveryScope = {
      document_types: input.document_types?.length ? input.document_types : ["prd", "srs", "doc"],
      source_path_prefixes: input.source_path_prefixes,
      chunk_kinds: input.chunk_kinds
    };
    const codeScope: ManifestDiscoveryScope = {
      document_types: ["code", "test"],
      source_path_prefixes: input.source_path_prefixes,
      chunk_kinds: input.chunk_kinds
    };

    const [exactOutcome, docsManOutcome, codeManOutcome, factsOutcome] = await Promise.allSettled([
      this.pipeline.resolveExactSources(workspace.project_id, input.optional_requirement_ids),
      this.pipeline.discoverManifestCandidates(workspace.project_id, input.feature_name, docsScope),
      this.pipeline.discoverManifestCandidates(workspace.project_id, input.feature_name, codeScope),
      this.graphiti.getCurrentFacts(workspace.project_id, input.feature_name)
    ]);

    let exact: CanonicalDocumentChunk[] = [];
    if (exactOutcome.status === "fulfilled") {
      exact = exactOutcome.value;
    } else {
      warnings.push("lightrag_exact_sources_failed");
    }

    let manifestDocs: CanonicalDocumentChunk[] = [];
    if (docsManOutcome.status === "fulfilled") {
      manifestDocs = docsManOutcome.value;
    } else {
      warnings.push("lightrag_manifest_docs_failed");
    }

    let manifestCode: CanonicalDocumentChunk[] = [];
    if (codeManOutcome.status === "fulfilled") {
      manifestCode = codeManOutcome.value;
    } else {
      warnings.push("lightrag_manifest_code_failed");
    }

    let facts: Record<string, unknown>[] = [];
    if (factsOutcome.status === "fulfilled") {
      facts = factsOutcome.value;
    } else {
      warnings.push("graphiti_unavailable");
    }

    const concepts = this.pipeline.extractConcepts(input.feature_name, exact);
    const semanticQuery = concepts.length ? concepts.join(" ") : input.feature_name;

    const supplementalLists: CanonicalDocumentChunk[][] = [manifestDocs, manifestCode];

    if (mode === "semantic") {
      const docBudget: LightRagSearchBudget = {
        ...SEMANTIC_BUDGET,
        document_types: docsScope.document_types,
        source_path_prefixes: docsScope.source_path_prefixes,
        chunk_kinds: docsScope.chunk_kinds
      };
      const { chunks, warning } = await this.pipeline.runScopedSemantic(workspace.project_id, semanticQuery, docBudget, "docs");
      if (warning) warnings.push(warning);
      supplementalLists.push(chunks);
    } else if (mode === "deep") {
      const docBudget: LightRagSearchBudget = {
        ...SEMANTIC_BUDGET,
        document_types: docsScope.document_types,
        source_path_prefixes: docsScope.source_path_prefixes,
        chunk_kinds: docsScope.chunk_kinds
      };
      const codeBudget: LightRagSearchBudget = {
        ...SEMANTIC_BUDGET,
        document_types: ["code", "test"],
        source_path_prefixes: codeScope.source_path_prefixes,
        chunk_kinds: codeScope.chunk_kinds
      };
      const [docRes, codeRes] = await Promise.all([
        this.pipeline.runScopedSemantic(workspace.project_id, semanticQuery, docBudget, "docs"),
        this.pipeline.runScopedSemantic(workspace.project_id, semanticQuery, codeBudget, "code")
      ]);
      if (docRes.warning) warnings.push(docRes.warning);
      if (codeRes.warning) warnings.push(codeRes.warning);
      supplementalLists.push(docRes.chunks, codeRes.chunks);
    }

    const supplemental = supplementalLists.flat();
    const merged = this.pipeline.mergeChunkLayers(exact, supplemental);

    return this.pipeline.assembleFeatureResponse({
      feature_name: input.feature_name,
      merged_chunks: merged,
      facts,
      warnings
    });
  }

  async prepareReviewContext(project_id: string | undefined, input: { changed_files?: string[]; diff?: string }) {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    return {
      project_id: workspace.project_id,
      changed_files: input.changed_files ?? [],
      diff_present: Boolean(input.diff),
      relevant_context: await this.lightrag.searchDocs(workspace.project_id, [...(input.changed_files ?? []), input.diff ?? ""].join("\n"), { limit: 8 })
    };
  }

  async validateAgainstSpecs(project_id: string | undefined, input: ValidateAgainstSpecsInput): Promise<ValidateAgainstSpecsResult> {
    const workspace = await this.workspaces.resolveProjectOrActive(project_id);
    const ni = normalizeValidateAgainstSpecsInput(input);
    const findings: ValidationFinding[] = [];
    const warnings: string[] = [];
    const missing_evidence: string[] = [];
    const checked_sources = new Set<string>();

    const hasDeclaredScope =
      ni.requirement_ids.length > 0 || Boolean(ni.artifact_path) || ni.changed_files.length > 0 || ni.source_paths.length > 0;

    if (!hasDeclaredScope) {
      missing_evidence.push("no_validation_scope");
      findings.push({
        severity: "warning",
        code: "no_validation_scope",
        message: "No requirement IDs, artifact path, or paths provided — nothing to validate."
      });
    }

    const strict = ni.mode === "strict";

    let resolvedRequirementCount = 0;
    let unresolvedRequirementCount = 0;

    const reqJobs = ni.requirement_ids.map((rid) =>
      this.pipeline
        .resolveExactSources(workspace.project_id, [rid])
        .then((chunks) => ({ rid, chunks }))
        .catch(() => {
          warnings.push("lightrag_exact_sources_failed");
          return { rid, chunks: [] as CanonicalDocumentChunk[] };
        })
    );
    const reqResults = await Promise.all(reqJobs);
    for (const { rid, chunks } of reqResults) {
      if (!chunks.length) {
        unresolvedRequirementCount += 1;
        missing_evidence.push(`requirement_unresolved:${rid}`);
        findings.push({
          severity: strict ? "error" : "warning",
          code: "requirement_unresolved",
          message: `No indexed spec context or requirement sources resolved for ${rid}.`,
          evidence: [{ requirement_id: rid }]
        });
      } else {
        resolvedRequirementCount += 1;
        for (const c of chunks) {
          if (c.source_path) checked_sources.add(c.source_path);
        }
        findings.push({
          severity: "info",
          code: "requirement_resolved",
          message: `Resolved evidence for ${rid}.`,
          evidence: chunks.slice(0, 12).map((c) => ({ chunk_id: c.chunk_id, source_path: c.source_path }))
        });
      }
    }

    const metaSettled = await Promise.allSettled([
      this.metadata.listChunks(workspace.project_id),
      this.metadata.listSpddArtifacts(workspace.project_id, {}),
      this.metadata.listSpddTraceLinks(workspace.project_id, { include_stale: true }),
      this.observability.getFreshnessReport(workspace.project_id, { include_stale: true })
    ]);

    let allChunks: CanonicalDocumentChunk[] = [];
    if (metaSettled[0].status === "fulfilled") {
      allChunks = metaSettled[0].value;
    } else {
      warnings.push("metadata_chunks_unavailable");
      missing_evidence.push("metadata_chunks_unavailable");
    }

    let artifacts: SpddArtifact[] = [];
    if (metaSettled[1].status === "fulfilled") {
      artifacts = metaSettled[1].value;
    } else {
      warnings.push("metadata_artifacts_unavailable");
    }

    let traceLinks: SpddTraceLink[] = [];
    if (metaSettled[2].status === "fulfilled") {
      traceLinks = metaSettled[2].value;
    } else {
      warnings.push("metadata_trace_links_unavailable");
    }

    let freshnessReport: ContextFreshnessReport | undefined;
    if (metaSettled[3].status === "fulfilled") {
      freshnessReport = metaSettled[3].value;
      findings.push(...freshnessSignalsToFindings(freshnessReport.signals));
      warnings.push(...freshnessReport.warnings);
    } else {
      warnings.push("freshness_report_unavailable");
      missing_evidence.push("freshness_report_unavailable");
    }

    const freshnessErrorCount = freshnessReport?.signals.filter((s) => s.severity === "error").length ?? 0;
    const freshnessWarningCount = freshnessReport?.signals.filter((s) => s.severity === "warning").length ?? 0;

    let artifactTracked = false;
    let artifactUntraced = false;
    let artifactReadOk = false;
    if (ni.artifact_path) {
      const ap = ni.artifact_path;
      const hits = artifacts.filter((a) => a.source_path === ap || a.source_path.endsWith(`/${ap}`) || a.source_path.endsWith(ap));
      if (hits.length) {
        artifactTracked = true;
        for (const a of hits) {
          checked_sources.add(a.source_path);
          if (a.status === "missing" || a.status === "stale") {
            findings.push({
              severity: "warning",
              code: `artifact_${a.status}`,
              message: `SPDD artifact metadata status is ${a.status} for ${a.source_path}.`,
              evidence: [{ artifact_id: a.artifact_id, source_path: a.source_path }]
            });
          }
        }
      } else {
        artifactUntraced = true;
        missing_evidence.push("artifact_not_in_trace_registry");
        findings.push({
          severity: "warning",
          code: "artifact_not_traced",
          message: "artifact_path is not present in SPDD artifact metadata — trace evidence may be missing.",
          evidence: [{ artifact_path: ap }]
        });
        const abs = resolvePathUnderWorkspaceRoot(workspace.rootPath, ap);
        if (abs) {
          try {
            const diskText = await readFile(abs, "utf8");
            artifactReadOk = true;
            checked_sources.add(normalizeRelativeValidationPath(ap) ?? ap);
            const diskIds = extractStableIdLiterals(diskText);
            if (diskIds.length) {
              findings.push({
                severity: "info",
                code: "artifact_stable_ids_on_disk",
                message: "Stable IDs detected in artifact file on disk.",
                evidence: diskIds.slice(0, 16).map((id) => ({ stable_id: id }))
              });
            }
          } catch {
            findings.push({
              severity: "warning",
              code: "artifact_unreadable",
              message: "Could not read artifact_path from workspace.",
              evidence: [{ artifact_path: ap }]
            });
          }
        }
      }
    }

    const pathsToScan = [...new Set([...ni.changed_files, ...ni.source_paths])];
    let stalePathCount = 0;
    let indexedPathHits = 0;
    let tracePathGapCount = 0;

    const linkMatchesPath = (p: string, links: SpddTraceLink[]) =>
      links.some(
        (l) =>
          (l.target_type === "source_path" && (l.target_id === p || l.source_path === p)) ||
          (typeof l.source_path === "string" && l.source_path === p)
      );

    for (const rawPath of pathsToScan) {
      const p = normalizeRelativeValidationPath(rawPath);
      if (!p) continue;
      const pathChunks = allChunks.filter((c) => c.source_path === p);
      if (!pathChunks.length) {
        try {
          const lrChunks = await this.lightrag.getDocument(workspace.project_id, { source_path: p });
          if (lrChunks.length) {
            indexedPathHits += 1;
            checked_sources.add(p);
            findings.push({
              severity: "warning",
              code: "metadata_lightrag_chunk_divergence",
              message: `SQLite metadata has no chunks for ${p}, but LightRAG returned document rows — indexes may be out of sync.`,
              evidence: [{ source_path: p, chunk_ids: lrChunks.slice(0, 8).map((c) => c.chunk_id) }]
            });
          } else {
            findings.push({
              severity: "warning",
              code: "path_not_indexed",
              message: `No indexed chunks for source path ${p}.`,
              evidence: [{ source_path: p }]
            });
            missing_evidence.push(`path_not_indexed:${p}`);
            warnings.push("lightrag_document_lookup_failed");
          }
        } catch {
          findings.push({
            severity: "warning",
            code: "path_not_indexed",
            message: `No indexed chunks for source path ${p}.`,
            evidence: [{ source_path: p }]
          });
          missing_evidence.push(`path_not_indexed:${p}`);
          warnings.push("lightrag_document_lookup_failed");
        }
      } else {
        indexedPathHits += 1;
        checked_sources.add(p);
        if (pathChunks.some((c) => c.status === "stale")) {
          stalePathCount += 1;
          findings.push({
            severity: "warning",
            code: "path_chunk_stale",
            message: `Stale chunks exist for ${p} — evidence may be outdated.`,
            evidence: [{ source_path: p }]
          });
        }
        const traced = linkMatchesPath(p, traceLinks);
        const wantsTraceAudit = Boolean(ni.artifact_path || ni.requirement_ids.length);
        if (!traced && wantsTraceAudit) {
          tracePathGapCount += 1;
          findings.push({
            severity: "warning",
            code: "path_not_traced",
            message: `No SPDD trace links reference source path ${p} — linkage may be incomplete.`,
            evidence: [{ source_path: p }]
          });
        }
      }
    }

    const topic =
      ni.requirement_ids[0] ??
      (ni.artifact_path ? ni.artifact_path.replace(/^.*\//, "").replace(/\.md$/i, "") : undefined) ??
      pathsToScan[0] ??
      "validation";

    let facts: Record<string, unknown>[] = [];
    try {
      facts = await this.graphiti.getCurrentFacts(workspace.project_id, topic, ni.requirement_ids[0]);
    } catch {
      warnings.push("graphiti_unavailable");
      missing_evidence.push("graphiti_facts_unavailable");
    }

    const scanText = `${capValidationText(ni.plan)}\n${capValidationText(ni.diff)}`;
    const scanStableLiterals = extractStableIdLiterals(scanText);

    for (const rid of ni.requirement_ids) {
      if (!scanText.includes(rid)) {
        findings.push({
          severity: "warning",
          code: "plan_missing_requirement_reference",
          message: `Plan/diff text does not mention declared requirement ${rid}.`,
          evidence: [{ requirement_id: rid }]
        });
      }
    }

    for (const fact of facts) {
      const ids = stableIdsReferencedInFact(fact);
      const overlap = ids.filter((id) => scanStableLiterals.includes(id) || scanText.includes(id));
      if (!overlap.length) continue;
      if (factLooksDeprecatedOrSuperseded(fact)) {
        findings.push({
          severity: strict ? "error" : "warning",
          code: "memory_deprecated_overlap",
          message: "Temporal memory entry looks deprecated/superseded but overlaps declared plan/diff identifiers — verify before relying on validation.",
          evidence: overlap.slice(0, 8).map((id) => ({ stable_id: id }))
        });
      }
    }

    const substantiveEvidence =
      hasDeclaredScope &&
      (resolvedRequirementCount > 0 ||
        indexedPathHits > 0 ||
        artifactTracked ||
        artifactReadOk ||
        (freshnessReport !== undefined && metaSettled[3].status === "fulfilled"));

    let confidence: ValidationConfidence = computeValidationConfidence({
      hasDeclaredScope,
      substantiveEvidence,
      unresolvedRequirementCount,
      stalePathCount,
      freshnessErrorCount,
      freshnessWarningCount,
      artifactUntraced,
      tracePathGapCount
    });

    if (hasDeclaredScope && missing_evidence.length > 0 && confidence === "high") {
      confidence = "medium";
    }

    if (!hasDeclaredScope) {
      confidence = "low";
    }

    warnings.push("MVP validation is heuristic and should be treated as advisory.");

    const dedupedWarnings = [...new Set(warnings)];
    const sortedFindings = sortFindingsBySeverity(findings);
    const valid = !sortedFindings.some((f) => f.severity === "error");

    return {
      project_id: workspace.project_id,
      valid,
      confidence,
      heuristic: true,
      checked_requirement_ids: ni.requirement_ids,
      checked_sources: [...checked_sources].sort(),
      findings: sortedFindings,
      missing_evidence: [...new Set(missing_evidence)].sort(),
      warnings: dedupedWarnings
    };
  }
}
