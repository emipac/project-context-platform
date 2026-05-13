import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

interface Workspace {
  project_id: string;
  name: string;
  rootPath: string;
  status: string;
}

type TabId = "projects" | "ingestion" | "documents" | "ids" | "search" | "memory" | "approvals" | "logs" | "settings";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "projects", label: "Projects" },
  { id: "ingestion", label: "Ingestion" },
  { id: "documents", label: "Document Index" },
  { id: "ids", label: "ID Registry" },
  { id: "search", label: "Search" },
  { id: "memory", label: "Memory" },
  { id: "approvals", label: "Approvals" },
  { id: "logs", label: "Tool Call Logs" },
  { id: "settings", label: "Settings" }
];

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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!activeProject) return;
    void loadProjectData(activeProject);
  }, [activeProject]);

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
      const [jobs, chunks, registry, memoryRows, approvalRows, logRows, settingsPayload] = await Promise.all([
        fetchJson<unknown[]>(`/api/projects/${projectId}/ingestion/status`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/documents`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/ids`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/memory`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/approvals`),
        fetchJson<unknown[]>(`/api/projects/${projectId}/tool-call-logs`),
        fetchJson<Record<string, unknown>>(`/api/projects/${projectId}/settings`)
      ]);
      setIngestion(jobs);
      setDocuments(chunks);
      setIds(registry);
      setMemory(memoryRows);
      setApprovals(approvalRows);
      setLogs(logRows);
      setSettings(settingsPayload);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function runSearch(event: React.FormEvent) {
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

  return (
    <main>
      <header>
        <div>
          <h1>Project Context</h1>
          <p className="subtitle">{activeProjectName ? `Workspace ${activeProjectName}` : "No workspace selected"}</p>
        </div>
        <select aria-label="Project workspace" value={activeProject} onChange={(event) => setActiveProject(event.target.value)}>
          {projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}
        </select>
      </header>

      <nav aria-label="Views">
        {tabs.map((tab) => (
          <button className={activeTab === tab.id ? "active" : ""} key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      {error ? <div className="banner error">{error}</div> : null}
      {loading ? <div className="banner">Loading platform data...</div> : null}

      <section>
        {activeTab === "projects" ? <Panel title="Projects" rows={projects} /> : null}
        {activeTab === "ingestion" ? <Panel title="Ingestion" rows={ingestion} /> : null}
        {activeTab === "documents" ? <Panel title="Document Index" rows={documents} /> : null}
        {activeTab === "ids" ? <Panel title="ID Registry" rows={ids} /> : null}
        {activeTab === "search" ? (
          <SearchPanel query={searchQuery} setQuery={setSearchQuery} onSearch={runSearch} rows={searchResults} />
        ) : null}
        {activeTab === "memory" ? <Panel title="Memory" rows={memory} /> : null}
        {activeTab === "approvals" ? <Panel title="Approvals" rows={approvals} /> : null}
        {activeTab === "logs" ? <Panel title="Tool Call Logs" rows={logs} /> : null}
        {activeTab === "settings" ? <SettingsPanel health={health} settings={settings} /> : null}
      </section>
    </main>
  );
}

function SearchPanel({ query, setQuery, onSearch, rows }: { query: string; setQuery: (value: string) => void; onSearch: (event: React.FormEvent) => void; rows: unknown[] }) {
  return (
    <>
      <div className="panel-title">
        <h2>Search</h2>
      </div>
      <form className="search" onSubmit={onSearch}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search canonical context" />
        <button type="submit">Search</button>
      </form>
      <Table rows={rows} />
    </>
  );
}

function SettingsPanel({ health, settings }: { health: Record<string, unknown> | null; settings: Record<string, unknown> | null }) {
  return (
    <>
      <div className="panel-title">
        <h2>Settings</h2>
      </div>
      <div className="summary-grid">
        <Summary label="API" value={String(health?.status ?? "unknown")} />
        <Summary label="Adapter" value={String(health?.adapter_mode ?? "unknown")} />
        <Summary label="LightRAG" value={String(health?.lightrag ?? "unknown")} />
        <Summary label="Graphiti" value={String(health?.graphiti ?? "unknown")} />
      </div>
      <pre>{JSON.stringify({ health, settings }, null, 2)}</pre>
    </>
  );
}

function Panel({ title, rows }: { title: string; rows: unknown[] }) {
  return (
    <>
      <div className="panel-title">
        <h2>{title}</h2>
        <span>{rows.length} rows</span>
      </div>
      <Table rows={rows} />
    </>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Table({ rows }: { rows: unknown[] }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  const normalizedRows = useMemo(() => rows.map((row) => row as Record<string, unknown>), [rows]);
  const keys = useMemo(() => Array.from(new Set(normalizedRows.flatMap((row) => Object.keys(row)))).slice(0, 8), [normalizedRows]);
  const filteredRows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const visibleRows = term
      ? normalizedRows.filter((row) => keys.some((key) => formatCell(row[key]).toLowerCase().includes(term)))
      : normalizedRows;
    if (!sort) return visibleRows;
    return [...visibleRows].sort((left, right) => compareCells(left[sort.key], right[sort.key], sort.direction));
  }, [filter, keys, normalizedRows, sort]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstRow = filteredRows.length ? (currentPage - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(currentPage * pageSize, filteredRows.length);

  useEffect(() => {
    setPage(1);
  }, [filter, pageSize, rows]);

  if (!rows.length) return <p className="empty">No rows</p>;
  return (
    <div className="data-grid">
      <div className="table-toolbar">
        <label>
          Filter
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Type to filter rows" />
        </label>
        <label>
          Rows
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>

      {filteredRows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {keys.map((key) => (
                  <th key={key}>
                    <button type="button" onClick={() => setSort(nextSort(sort, key))}>
                      {key}
                      <span>{sort?.key === key ? (sort.direction === "asc" ? " up" : " down") : ""}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, index) => (
                <tr key={`${currentPage}-${index}`}>
                  {keys.map((key) => <td className={isLongCell(key, row[key]) ? "long-cell" : ""} key={key}>{renderCell(row[key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">No matching rows</p>
      )}

      <div className="pagination">
        <span>{firstRow}-{lastRow} of {filteredRows.length}</span>
        <div>
          <button type="button" disabled={currentPage === 1} onClick={() => setPage(1)}>First</button>
          <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
          <span>Page {currentPage} of {totalPages}</span>
          <button type="button" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
          <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(totalPages)}>Last</button>
        </div>
      </div>
    </div>
  );
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON from ${path}; received ${contentType || "unknown content type"}`);
  }
  return response.json() as Promise<T>;
}

function formatCell(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.length > 3 ? `${value.length} items` : value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function renderCell(value: unknown): React.ReactNode {
  const text = formatCell(value);
  if (text.length <= 260) return text;
  return <span title={text}>{text.slice(0, 260)}...</span>;
}

function isLongCell(key: string, value: unknown): boolean {
  return key === "content" || formatCell(value).length > 260;
}

function nextSort(current: { key: string; direction: "asc" | "desc" } | null, key: string): { key: string; direction: "asc" | "desc" } | null {
  if (current?.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

function compareCells(left: unknown, right: unknown, direction: "asc" | "desc"): number {
  const leftText = formatCell(left);
  const rightText = formatCell(right);
  const leftNumber = Number(leftText);
  const rightNumber = Number(rightText);
  const result = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? leftNumber - rightNumber
    : leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown UI error";
}

createRoot(document.getElementById("root")!).render(<App />);
