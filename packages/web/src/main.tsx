import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { fetchJson } from "./api.js";
import type { SearchRequestBody } from "./search-request.js";
import { AppShell } from "./components/AppShell.js";
import { Panel } from "./components/Panel.js";
import { errorMessage } from "./error-message.js";
import { SearchPanel } from "./tabs/SearchPanel.js";
import { SettingsPanel } from "./tabs/SettingsPanel.js";
import { ContextFreshnessPanel } from "./tabs/ContextFreshnessPanel.js";
import { SpddTracePanel } from "./tabs/SpddTracePanel.js";
import { tabs } from "./tabs.js";
import type {
  DocumentIndexPayload,
  ServerPaginationChange,
  SpddArtifactsPayload,
  SpddTraceBundle,
  TabId,
  TablePaginationConfig,
  Workspace
} from "./types.js";

function App() {
  const [projects, setProjects] = useState<Workspace[]>([]);
  const [activeProject, setActiveProject] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("projects");
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [ingestion, setIngestion] = useState<unknown[]>([]);
  const [documents, setDocuments] = useState<unknown[]>([]);
  const [documentTotal, setDocumentTotal] = useState(0);
  const [documentLimit, setDocumentLimit] = useState(50);
  const [documentOffset, setDocumentOffset] = useState(0);
  const [documentStatus, setDocumentStatus] = useState("current");
  const [documentChunkKind, setDocumentChunkKind] = useState("");
  const [documentOrder, setDocumentOrder] = useState("desc");
  const [ids, setIds] = useState<unknown[]>([]);
  const [memory, setMemory] = useState<unknown[]>([]);
  const [approvals, setApprovals] = useState<unknown[]>([]);
  const [logs, setLogs] = useState<unknown[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [spddRuns, setSpddRuns] = useState<SpddTraceBundle | null>(null);
  const [spddArtifacts, setSpddArtifacts] = useState<SpddArtifactsPayload | null>(null);
  const [spddLookup, setSpddLookup] = useState<SpddTraceBundle | null>(null);
  const [lookupStableId, setLookupStableId] = useState("");
  const [lookupSourcePath, setLookupSourcePath] = useState("");
  const [lookupChunkId, setLookupChunkId] = useState("");
  const [lookupFeatureRef, setLookupFeatureRef] = useState("");
  const [includeStaleIds, setIncludeStaleIds] = useState(false);
  const [includeStaleSpdd, setIncludeStaleSpdd] = useState(false);
  const [searchResults, setSearchResults] = useState<unknown[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!activeProject) return;
    setIncludeStaleIds(false);
    setIncludeStaleSpdd(false);
    setDocumentOffset(0);
    setDocumentStatus("current");
    setDocumentChunkKind("");
    setDocumentOrder("desc");
    setSearchResults([]);
  }, [activeProject]);

  useEffect(() => {
    if (!activeProject) return;
    void loadProjectData(activeProject);
  }, [activeProject, documentLimit, documentOffset, documentStatus, documentChunkKind, documentOrder, includeStaleIds, includeStaleSpdd]);

  const activeProjectName = useMemo(() => projects.find((project) => project.project_id === activeProject)?.name ?? activeProject, [activeProject, projects]);

  const documentPaginationRef = useRef({
    documentTotal,
    documentLimit,
    documentOffset
  });
  documentPaginationRef.current = { documentTotal, documentLimit, documentOffset };

  const handleDocumentPaginationChange = useCallback((next: ServerPaginationChange) => {
    const { documentTotal: total, documentLimit: prevLimit } = documentPaginationRef.current;
    const newLimit = next.limit;
    const offsetBase = newLimit !== prevLimit ? 0 : next.offset;
    const maxOffset = total > 0 && newLimit > 0 ? Math.max(0, Math.floor((total - 1) / newLimit) * newLimit) : 0;
    const clamped = Math.max(0, Math.min(offsetBase, maxOffset));
    setDocumentLimit(newLimit);
    setDocumentOffset(clamped);
  }, []);

  const documentTablePagination: TablePaginationConfig = useMemo(
    () => ({
      mode: "server",
      total: documentTotal,
      limit: documentLimit,
      offset: documentOffset,
      onChange: handleDocumentPaginationChange
    }),
    [documentTotal, documentLimit, documentOffset, handleDocumentPaginationChange]
  );

  async function loadProjects() {
    setLoading(true);
    setError("");
    try {
      const [projectRows, healthPayload] = await Promise.all([
        fetchJson<Workspace[]>("/api/projects"),
        fetchJson<Record<string, unknown>>("/health")
      ]);
      setProjects(projectRows);
      setHealth(healthPayload);
      setActiveProject((current) => current || projectRows[0]?.project_id || "");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadProjectData(projectId: string) {
    setError("");
    try {
      const docParams = new URLSearchParams({
        limit: String(documentLimit),
        offset: String(documentOffset),
        status: documentStatus,
        order_by: "updated_at",
        order: documentOrder
      });
      if (documentChunkKind) docParams.set("chunk_kind", documentChunkKind);
      const idsQs = includeStaleIds ? "?include_stale=true" : "";
      const spddQs = includeStaleSpdd ? "?limit=100&include_stale=true" : "?limit=100";
      const [jobs, chunkPayload, registry, memoryRows, approvalRows, logRows, settingsPayload, spddRunsPayload, spddArtifactsPayload] = await Promise.all([
        fetchJson<unknown[]>(`/api/projects/${projectId}/ingestion/status`),
        fetchJson<DocumentIndexPayload>(`/api/projects/${projectId}/documents?${docParams.toString()}`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/ids${idsQs}`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/memory`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/approvals`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/tool-call-logs`),
        fetchJson<Record<string, unknown>>(`/api/projects/${projectId}/settings`),
        fetchJson<SpddTraceBundle>(`/api/projects/${projectId}/spdd-trace/runs${spddQs}`),
        fetchJson<SpddArtifactsPayload>(`/api/projects/${projectId}/spdd-trace/artifacts${spddQs}`)
      ]);
      const healthPayload = await fetchJson<Record<string, unknown>>(`/health?project_id=${encodeURIComponent(projectId)}`);
      setIngestion(jobs);
      setDocuments(chunkPayload.chunks);
      setDocumentTotal(chunkPayload.total);
      setDocumentLimit(chunkPayload.limit);
      setDocumentOffset(chunkPayload.offset);
      setIds(registry);
      setMemory(memoryRows);
      setApprovals(approvalRows);
      setLogs(logRows);
      setHealth(healthPayload);
      setSettings(settingsPayload);
      setSpddRuns(spddRunsPayload);
      setSpddArtifacts(spddArtifactsPayload);
      setSpddLookup(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function syncSpddArtifacts() {
    if (!activeProject) return;
    setError("");
    try {
      await fetchJson(`/api/projects/${activeProject}/spdd-trace/artifacts/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      await loadProjectData(activeProject);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function runSpddLookup(event: FormEvent) {
    event.preventDefault();
    if (!activeProject) return;
    const params = new URLSearchParams();
    if (lookupStableId.trim()) params.set("stable_id", lookupStableId.trim());
    if (lookupSourcePath.trim()) params.set("source_path", lookupSourcePath.trim());
    if (lookupChunkId.trim()) params.set("chunk_id", lookupChunkId.trim());
    if (lookupFeatureRef.trim()) params.set("feature_ref", lookupFeatureRef.trim());
    if (includeStaleSpdd) params.set("include_stale", "true");
    const qs = params.toString();
    setError("");
    if (!qs) {
      setError("Provide at least one lookup field.");
      return;
    }
    try {
      setSpddLookup(await fetchJson<SpddTraceBundle>(`/api/projects/${activeProject}/spdd-trace/lookup?${qs}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function runSearch(body: SearchRequestBody) {
    if (!activeProject || !body.query.trim()) return;
    setError("");
    setSearchLoading(true);
    try {
      setSearchResults(await fetchJson<unknown[]>(`/api/projects/${activeProject}/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSearchLoading(false);
    }
  }

  function renderActiveTab() {
    switch (activeTab) {
      case "projects":
        return <Panel title="Projects" rows={projects} />;
      case "ingestion":
        return <Panel title="Ingestion" rows={ingestion} />;
      case "documents":
        return (
          <Panel
            title="Document Index"
            rows={documents}
            preferredKeys={["source_path", "chunk_kind", "chunk_index", "heading", "stable_ids", "status", "line_start", "updated_at", "content"]}
            maxColumns={9}
            pagination={documentTablePagination}
            headerExtra={
              <span className="panel-toolbar">
                <label>
                  Status
                  <select value={documentStatus} onChange={(event) => { setDocumentOffset(0); setDocumentStatus(event.target.value); }}>
                    <option value="current">Current</option>
                    <option value="stale">Stale</option>
                    <option value="all">All</option>
                  </select>
                </label>
                <label>
                  Chunk kind
                  <select value={documentChunkKind} onChange={(event) => { setDocumentOffset(0); setDocumentChunkKind(event.target.value); }}>
                    <option value="">All</option>
                    <option value="file">File</option>
                    <option value="markdown_section">Markdown section</option>
                    <option value="stable_id_anchor">Stable-ID anchor</option>
                    <option value="markdown_table_row">Markdown table row</option>
                  </select>
                </label>
                <label>
                  Updated
                  <select value={documentOrder} onChange={(event) => { setDocumentOffset(0); setDocumentOrder(event.target.value); }}>
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </label>
              </span>
            }
          />
        );
      case "ids":
        return (
          <Panel
            title="ID Registry"
            rows={ids}
            headerExtra={
              <span className="panel-toolbar">
                <label className="stale-toggle">
                  <input type="checkbox" checked={includeStaleIds} onChange={(event) => setIncludeStaleIds(event.target.checked)} />
                  Include stale
                </label>
              </span>
            }
          />
        );
      case "search":
        return <SearchPanel onSearch={runSearch} rows={searchResults} loading={searchLoading} />;
      case "memory":
        return (
          <Panel
            title="Memory"
            rows={memory}
            preferredKeys={["topic", "summary", "type", "status", "related_files", "related_requirements", "created_at", "graph_ingestion_status", "graph_ingestion_error", "payload"]}
            maxColumns={10}
          />
        );
      case "approvals":
        return <Panel title="Approvals" rows={approvals} />;
      case "logs":
        return <Panel title="Tool Call Logs" rows={logs} />;
      case "contextHealth":
        return activeProject ? <ContextFreshnessPanel projectId={activeProject} /> : <Panel title="Context Health" rows={[]} />;
      case "spddTrace":
        return (
          <SpddTracePanel
            runsPayload={spddRuns}
            artifactsPayload={spddArtifacts}
            lookupPayload={spddLookup}
            lookupStableId={lookupStableId}
            lookupSourcePath={lookupSourcePath}
            lookupChunkId={lookupChunkId}
            lookupFeatureRef={lookupFeatureRef}
            setLookupStableId={setLookupStableId}
            setLookupSourcePath={setLookupSourcePath}
            setLookupChunkId={setLookupChunkId}
            setLookupFeatureRef={setLookupFeatureRef}
            includeStaleTrace={includeStaleSpdd}
            onIncludeStaleTraceChange={setIncludeStaleSpdd}
            onLookup={runSpddLookup}
            onSync={syncSpddArtifacts}
          />
        );
      case "settings":
        return <SettingsPanel projectId={activeProject} health={health} settings={settings} />;
    }
  }

  return (
    <AppShell
      activeProjectName={activeProjectName}
      projects={projects}
      activeProject={activeProject}
      setActiveProject={setActiveProject}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      tabs={tabs}
      error={error}
      loading={loading}
    >
      {renderActiveTab()}
    </AppShell>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
