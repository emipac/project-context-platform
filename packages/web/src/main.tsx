import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { fetchJson } from "./api.js";
import { AppShell } from "./components/AppShell.js";
import { Panel } from "./components/Panel.js";
import { errorMessage } from "./error-message.js";
import { SearchPanel } from "./tabs/SearchPanel.js";
import { SettingsPanel } from "./tabs/SettingsPanel.js";
import { ContextFreshnessPanel } from "./tabs/ContextFreshnessPanel.js";
import { SpddTracePanel } from "./tabs/SpddTracePanel.js";
import { tabs } from "./tabs.js";
import type { SpddArtifactsPayload, SpddTraceBundle, TabId, Workspace } from "./types.js";

function App() {
  const [projects, setProjects] = useState<Workspace[]>([]);
  const [activeProject, setActiveProject] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("projects");
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [ingestion, setIngestion] = useState<unknown[]>([]);
  const [documents, setDocuments] = useState<unknown[]>([]);
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
  const [includeStaleDocs, setIncludeStaleDocs] = useState(false);
  const [includeStaleIds, setIncludeStaleIds] = useState(false);
  const [includeStaleSpdd, setIncludeStaleSpdd] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!activeProject) return;
    setIncludeStaleDocs(false);
    setIncludeStaleIds(false);
    setIncludeStaleSpdd(false);
  }, [activeProject]);

  useEffect(() => {
    if (!activeProject) return;
    void loadProjectData(activeProject);
  }, [activeProject, includeStaleDocs, includeStaleIds, includeStaleSpdd]);

  const activeProjectName = useMemo(() => projects.find((project) => project.project_id === activeProject)?.name ?? activeProject, [activeProject, projects]);

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
      const docQs = includeStaleDocs ? "?limit=200&include_stale=true" : "?limit=200";
      const idsQs = includeStaleIds ? "?include_stale=true" : "";
      const spddQs = includeStaleSpdd ? "?limit=100&include_stale=true" : "?limit=100";
      const [jobs, chunks, registry, memoryRows, approvalRows, logRows, settingsPayload, spddRunsPayload, spddArtifactsPayload] = await Promise.all([
        fetchJson<unknown[]>(`/api/projects/${projectId}/ingestion/status`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/documents${docQs}`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/ids${idsQs}`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/memory`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/approvals`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/tool-call-logs`),
        fetchJson<Record<string, unknown>>(`/api/projects/${projectId}/settings`),
        fetchJson<SpddTraceBundle>(`/api/projects/${projectId}/spdd-trace/runs${spddQs}`),
        fetchJson<SpddArtifactsPayload>(`/api/projects/${projectId}/spdd-trace/artifacts${spddQs}`)
      ]);
      setIngestion(jobs);
      setDocuments(chunks);
      setIds(registry);
      setMemory(memoryRows);
      setApprovals(approvalRows);
      setLogs(logRows);
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

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    if (!activeProject || !searchQuery.trim()) return;
    setError("");
    try {
      setSearchResults(await fetchJson<unknown[]>(`/api/projects/${activeProject}/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: searchQuery, limit: 12 })
      }));
    } catch (err) {
      setError(errorMessage(err));
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
            headerExtra={
              <span className="panel-toolbar">
                <label className="stale-toggle">
                  <input type="checkbox" checked={includeStaleDocs} onChange={(event) => setIncludeStaleDocs(event.target.checked)} />
                  Include stale
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
        return <SearchPanel query={searchQuery} setQuery={setSearchQuery} onSearch={runSearch} rows={searchResults} />;
      case "memory":
        return <Panel title="Memory" rows={memory} />;
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
        return <SettingsPanel health={health} settings={settings} />;
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
