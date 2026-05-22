import { relative, resolve } from "node:path";
import type {
  FreshnessSignal,
  ValidateAgainstSpecsInput,
  ValidationConfidence,
  ValidationFinding,
  ValidationFindingSeverity
} from "../domain/types.js";

/** Bound plan/diff scans for deterministic validation (bytes). */
export const VALIDATION_TEXT_CAP = 32 * 1024;

const STABLE_ID_RE = /\b(?:REQ|TASK|ADR|AC|NFR|DEC|REV|IMPL|REQCHG|DP)-[A-Z0-9][A-Z0-9._-]*\b/gi;

export function normalizeRelativeValidationPath(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
  return trimmed || undefined;
}

/** Resolve `relativePath` under `rootPath`; returns undefined if path escapes root. */
export function resolvePathUnderWorkspaceRoot(rootPath: string, relativePath: string): string | undefined {
  const normalized = normalizeRelativeValidationPath(relativePath);
  if (!normalized) return undefined;
  const resolved = resolve(rootPath, normalized);
  const rootResolved = resolve(rootPath);
  const rel = relative(rootResolved, resolved);
  if (rel.startsWith("..") || rel === "..") return undefined;
  return resolved;
}

export function capValidationText(s: string | undefined): string {
  if (!s) return "";
  return s.length <= VALIDATION_TEXT_CAP ? s : s.slice(0, VALIDATION_TEXT_CAP);
}

export function extractStableIdLiterals(text: string): string[] {
  const out: string[] = [];
  STABLE_ID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STABLE_ID_RE.exec(text)) !== null) {
    const id = m[0];
    if (!out.includes(id)) out.push(id);
    if (out.length >= 64) break;
  }
  return out;
}

const SEVERITY_ORDER: Record<ValidationFindingSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2
};

export function sortFindingsBySeverity(findings: ValidationFinding[]): ValidationFinding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Map high-severity freshness signals to validation findings (info omitted). */
export function freshnessSignalsToFindings(signals: FreshnessSignal[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const s of signals) {
    if (s.severity === "info") continue;
    const severity: ValidationFindingSeverity = s.severity === "error" ? "error" : "warning";
    const evidence =
      s.count !== undefined
        ? [{ code: s.code, count: s.count }]
        : [{ code: s.code, evidence_type: s.evidence_type }];
    findings.push({
      severity,
      code: s.code,
      message: s.message,
      evidence
    });
  }
  return findings;
}

export function normalizeValidateAgainstSpecsInput(input: ValidateAgainstSpecsInput): {
  plan?: string;
  diff?: string;
  requirement_ids: string[];
  artifact_path?: string;
  changed_files: string[];
  source_paths: string[];
  mode: "fast" | "strict";
} {
  const trimArr = (xs?: string[]) => (xs ?? []).map((s) => s.trim()).filter(Boolean);
  return {
    plan: input.plan?.trim() || undefined,
    diff: input.diff?.trim() || undefined,
    requirement_ids: trimArr(input.requirement_ids),
    artifact_path: input.artifact_path?.trim() || undefined,
    changed_files: trimArr(input.changed_files),
    source_paths: trimArr(input.source_paths),
    mode: input.mode === "strict" ? "strict" : "fast"
  };
}

export function computeValidationConfidence(params: {
  hasDeclaredScope: boolean;
  substantiveEvidence: boolean;
  unresolvedRequirementCount: number;
  stalePathCount: number;
  freshnessErrorCount: number;
  freshnessWarningCount: number;
  artifactUntraced: boolean;
  tracePathGapCount: number;
}): ValidationConfidence {
  if (!params.hasDeclaredScope || !params.substantiveEvidence) return "low";

  let score = 5;
  if (params.unresolvedRequirementCount > 0) score -= 2;
  if (params.stalePathCount > 0) score -= 1;
  if (params.freshnessErrorCount > 0) score -= 2;
  else if (params.freshnessWarningCount > 0) score -= 1;
  if (params.artifactUntraced) score -= 1;
  if (params.tracePathGapCount > 0) score -= 1;

  if (score <= 1) return "low";
  if (score <= 3) return "medium";
  return "high";
}

/** Pull stable IDs from a Graphiti fact payload without echoing full blobs into evidence. */
export function stableIdsReferencedInFact(fact: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) {
      const t = v.trim();
      if (!out.includes(t)) out.push(t);
    }
  };
  push(fact.stable_id);
  const related = fact.related_requirements;
  if (Array.isArray(related)) {
    for (const x of related) push(x);
  }
  const ids = fact.stable_ids;
  if (Array.isArray(ids)) {
    for (const x of ids) push(x);
  }
  return out.slice(0, 32);
}

export function factLooksDeprecatedOrSuperseded(fact: Record<string, unknown>): boolean {
  const blob = JSON.stringify(fact).toLowerCase();
  return blob.includes("deprecated") || blob.includes("superseded");
}
