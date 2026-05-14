import { Summary } from "../components/Summary.js";

export function SettingsPanel({
  health,
  settings
}: {
  health: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
}) {
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
