import { useState } from "react";
import { fetchJson } from "../api.js";
import { Summary } from "../components/Summary.js";
import { errorMessage } from "../error-message.js";

export function SettingsPanel({
  projectId,
  health,
  settings
}: {
  projectId: string;
  health: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
}) {
  const [deepHealth, setDeepHealth] = useState<Record<string, unknown> | null>(null);
  const [loadingDeepHealth, setLoadingDeepHealth] = useState(false);
  const [deepHealthError, setDeepHealthError] = useState("");

  async function loadDeepHealth() {
    if (!projectId) return;
    setLoadingDeepHealth(true);
    setDeepHealthError("");
    try {
      setDeepHealth(await fetchJson<Record<string, unknown>>(`/health?project_id=${encodeURIComponent(projectId)}&deep=true`));
    } catch (err) {
      setDeepHealthError(errorMessage(err));
    } finally {
      setLoadingDeepHealth(false);
    }
  }

  return (
    <>
      <div className="panel-title">
        <div>
          <h2>Settings</h2>
          <p className="section-help">Default health is shallow. Use deep health to parse LightRAG JSON stores and detect corruption.</p>
        </div>
        <button type="button" className="btn btn-sync-artifacts" disabled={loadingDeepHealth || !projectId} onClick={() => void loadDeepHealth()}>
          {loadingDeepHealth ? "Loading deep health…" : "Load deep health JSON"}
        </button>
      </div>
      {deepHealthError ? <div className="banner error">{deepHealthError}</div> : null}
      <div className="summary-grid">
        <Summary label="API" value={String(health?.status ?? "unknown")} />
        <Summary label="Adapter" value={String(health?.adapter_mode ?? "unknown")} />
        <Summary label="LightRAG" value={String(health?.lightrag ?? "unknown")} />
        <Summary label="Graphiti" value={String(health?.graphiti ?? "unknown")} />
      </div>
      <pre>{JSON.stringify({ health, settings }, null, 2)}</pre>
      {deepHealth ? (
        <>
          <div className="section-heading">
            <h3>Deep Health JSON</h3>
            <p>Project-scoped health with `deep=true`; LightRAG storage JSON files are parsed.</p>
          </div>
          <pre>{JSON.stringify({ deepHealth }, null, 2)}</pre>
        </>
      ) : null}
    </>
  );
}
