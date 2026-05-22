import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "../api.js";
import { errorMessage } from "../error-message.js";
import { InfoCard } from "../components/InfoCard.js";
import { Summary } from "../components/Summary.js";
import { Table } from "../components/Table.js";

interface FreshnessPayload {
  project_id?: string;
  status?: string;
  generated_at?: string;
  last_ingested_at?: string;
  signals?: unknown[];
  summary?: Record<string, unknown>;
  warnings?: unknown[];
}

interface QualityPayload {
  project_id?: string;
  generated_at?: string;
  stale_chunk_count?: number;
  stale_id_count?: number;
  duplicate_id_count?: number;
  unresolved_trace_link_count?: number;
  trace_coverage_ratio?: number;
  validation_usage_count?: number;
  failed_tool_call_count?: number;
  memory_mirror_ratio?: number;
  warnings?: unknown[];
}

interface StorageHealthProject {
  status?: string;
  project_id?: string;
  path?: string;
  checked_files?: number;
  json_file_count?: number;
  total_bytes?: number;
  files?: unknown[];
  corrupt_files?: unknown[];
  warnings?: unknown[];
}

interface StorageHealthPayload {
  status?: string;
  data_dir?: string;
  deep?: boolean;
  checked_files?: number;
  corrupt_file_count?: number;
  project_count?: number;
  projects?: Record<string, StorageHealthProject>;
  warnings?: unknown[];
}

export function ContextFreshnessPanel({ projectId }: { projectId: string }) {
  const [freshness, setFreshness] = useState<FreshnessPayload | null>(null);
  const [quality, setQuality] = useState<QualityPayload | null>(null);
  const [storageHealth, setStorageHealth] = useState<StorageHealthPayload | null>(null);
  const [gitCompare, setGitCompare] = useState(false);
  const [loading, setLoading] = useState(false);
  const [storageLoading, setStorageLoading] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const detect = gitCompare ? "changed_file_detection=auto" : "";
      const freshnessUrl = `/api/projects/${projectId}/context/freshness${detect ? `?${detect}` : ""}`;
      const [fr, ql] = await Promise.all([
        fetchJson<FreshnessPayload>(freshnessUrl),
        fetchJson<QualityPayload>(`/api/projects/${projectId}/context/quality`)
      ]);
      setFreshness(fr);
      setQuality(ql);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, gitCompare]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadStorageHealth = useCallback(async () => {
    if (!projectId) return;
    setStorageLoading(true);
    setStorageError("");
    try {
      setStorageHealth(await fetchJson<StorageHealthPayload>(`/api/projects/${projectId}/storage/health?deep=true`));
    } catch (err) {
      setStorageError(errorMessage(err));
    } finally {
      setStorageLoading(false);
    }
  }, [projectId]);

  if (!projectId) return <p className="empty">Select a project to inspect context health.</p>;

  const summary = freshness?.summary ?? {};
  const metricWarnings = Array.isArray(quality?.warnings) ? quality!.warnings : [];

  return (
    <>
      <div className="panel-title">
        <div>
          <h2>Context Health</h2>
          <p className="section-help">
            Operational freshness and trace-quality indicators derived from local metadata — not proof that retrieval answers are correct.
          </p>
        </div>
        <div className="context-health-actions">
          <label className="stale-toggle">
            <input type="checkbox" checked={gitCompare} onChange={(event) => setGitCompare(event.target.checked)} />
            Git changed-file heuristic (auto)
          </label>
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void load()}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="btn" disabled={storageLoading} onClick={() => void loadStorageHealth()}>
            {storageLoading ? "Checking storage…" : "Check LightRAG storage"}
          </button>
        </div>
      </div>

      {error ? <div className="banner">{error}</div> : null}
      {storageError ? <div className="banner error">{storageError}</div> : null}

      <div className="info-grid">
        <InfoCard
          title="Freshness status"
          body="Summarizes ingestion history, stale registry rows, SPDD trace gaps, and optional git-vs-index hints."
        />
        <InfoCard
          title="Quality metrics"
          body="Deterministic ratios from SQLite metadata and MCP tool-call logs. Interpret as engineering telemetry, not specification compliance."
        />
      </div>

      <div className="summary-grid">
        <Summary label="Freshness" value={String(freshness?.status ?? "—")} />
        <Summary label="Last ingest (completed job)" value={freshness?.last_ingested_at ? String(freshness.last_ingested_at) : "—"} />
        <Summary label="Stale chunks" value={String(summary.stale_chunk_count ?? "—")} />
        <Summary label="Stale ID rows" value={String(summary.stale_registry_count ?? "—")} />
        <Summary label="Unresolved trace links" value={String(summary.unresolved_trace_link_count ?? "—")} />
        <Summary label="Duplicate / ambiguous IDs" value={String(summary.duplicate_registry_count ?? "—")} />
        <Summary label="Trace coverage ratio" value={quality?.trace_coverage_ratio != null ? Number(quality.trace_coverage_ratio).toFixed(2) : "—"} />
        <Summary label="Validate tool usage (ok)" value={String(quality?.validation_usage_count ?? "—")} />
        <Summary label="Failed MCP calls" value={String(quality?.failed_tool_call_count ?? "—")} />
        <Summary label="Memory mirror ratio (runs)" value={quality?.memory_mirror_ratio != null ? Number(quality.memory_mirror_ratio).toFixed(2) : "—"} />
        <Summary label="LightRAG storage" value={String(storageHealth?.status ?? "not checked")} />
        <Summary label="Corrupt JSON files" value={String(storageHealth?.corrupt_file_count ?? "—")} />
      </div>

      {metricWarnings.length ? (
        <div className="banner">Quality warnings: {JSON.stringify(metricWarnings)}</div>
      ) : null}
      {freshness?.warnings && freshness.warnings.length ? (
        <div className="banner">Freshness warnings: {JSON.stringify(freshness.warnings)}</div>
      ) : null}
      {storageHealth ? <StorageHealthDetails projectId={projectId} payload={storageHealth} /> : null}

      <section className="trace-section">
        <div className="section-heading">
          <h3>Signals</h3>
          <p>Factual signals come from explicit metadata statuses; git-based rows are heuristic.</p>
        </div>
        <Table rows={(freshness?.signals as unknown[]) ?? []} />
      </section>
    </>
  );
}

function StorageHealthDetails({ projectId, payload }: { projectId: string; payload: StorageHealthPayload }) {
  const projectEntries = Object.entries(payload.projects ?? {});
  const [reportedProjectId, project] = projectEntries.find(([id]) => id === projectId) ?? projectEntries[0] ?? [projectId, undefined];
  const corruptFiles = (project?.corrupt_files ?? []) as unknown[];
  const files = (project?.files ?? []) as unknown[];
  const warnings = [...(payload.warnings ?? []), ...(project?.warnings ?? [])];
  return (
    <section className="trace-section">
      <div className="section-heading">
        <h3>LightRAG Storage Health</h3>
        <p>
          Deep JSON validation for sidecar persisted storage. This detects malformed derived index files before ingestion or retrieval fails.
        </p>
      </div>
      <div className="storage-health-meta">
        <span>Status: {String(payload.status ?? "unknown")}</span>
        <span>Project: {String(reportedProjectId)}</span>
        <span>Data dir: {String(payload.data_dir ?? "—")}</span>
        <span>Checked files: {String(project?.checked_files ?? payload.checked_files ?? "—")}</span>
        <span>JSON files: {String(project?.json_file_count ?? "—")}</span>
      </div>
      {warnings.length ? <div className="banner">Storage warnings: {JSON.stringify(warnings)}</div> : null}
      {corruptFiles.length ? (
        <>
          <div className="section-heading">
            <h3>Corrupt JSON Files</h3>
            <p>These files should be treated as stale LightRAG-derived index state and rebuilt from project sources.</p>
          </div>
          <Table rows={corruptFiles} preferredKeys={["name", "path", "size_bytes", "error", "line", "column", "position"]} maxColumns={7} />
        </>
      ) : null}
      <div className="section-heading">
        <h3>Storage Files</h3>
        <p>Current JSON stores found for the selected LightRAG project.</p>
      </div>
      <Table rows={files} preferredKeys={["name", "size_bytes", "modified_at", "json_valid", "error"]} maxColumns={5} />
    </section>
  );
}
