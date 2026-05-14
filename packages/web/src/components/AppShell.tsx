import type { ReactNode } from "react";
import type { TabId, Workspace } from "../types.js";

interface AppShellProps {
  activeProjectName: string;
  projects: Workspace[];
  activeProject: string;
  setActiveProject: (value: string) => void;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  tabs: Array<{ id: TabId; label: string }>;
  error: string;
  loading: boolean;
  children: ReactNode;
}

export function AppShell({
  activeProjectName,
  projects,
  activeProject,
  setActiveProject,
  activeTab,
  setActiveTab,
  tabs: tabItems,
  error,
  loading,
  children
}: AppShellProps) {
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
        {tabItems.map((tab) => (
          <button className={activeTab === tab.id ? "active" : ""} key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      {error ? <div className="banner error">{error}</div> : null}
      {loading ? <div className="banner">Loading platform data...</div> : null}

      <section>{children}</section>
    </main>
  );
}
