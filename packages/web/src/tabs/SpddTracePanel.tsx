import { useMemo } from "react";
import type { FormEvent } from "react";
import { InfoCard } from "../components/InfoCard.js";
import { Summary } from "../components/Summary.js";
import { Table } from "../components/Table.js";
import { formatArtifactRows } from "../formatters.js";
import type { SpddArtifactsPayload, SpddTraceBundle } from "../types.js";

function TraceTableSection({ title, description, rows }: { title: string; description: string; rows: unknown[] }) {
  return (
    <section className="trace-section">
      <div className="section-heading">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <Table rows={rows} />
    </section>
  );
}

export function SpddTracePanel({
  runsPayload,
  artifactsPayload,
  lookupPayload,
  lookupStableId,
  lookupSourcePath,
  lookupChunkId,
  lookupFeatureRef,
  setLookupStableId,
  setLookupSourcePath,
  setLookupChunkId,
  setLookupFeatureRef,
  includeStaleTrace,
  onIncludeStaleTraceChange,
  onLookup,
  onSync
}: {
  runsPayload: SpddTraceBundle | null;
  artifactsPayload: SpddArtifactsPayload | null;
  lookupPayload: SpddTraceBundle | null;
  lookupStableId: string;
  lookupSourcePath: string;
  lookupChunkId: string;
  lookupFeatureRef: string;
  setLookupStableId: (value: string) => void;
  setLookupSourcePath: (value: string) => void;
  setLookupChunkId: (value: string) => void;
  setLookupFeatureRef: (value: string) => void;
  includeStaleTrace: boolean;
  onIncludeStaleTraceChange: (value: boolean) => void;
  onLookup: (event: FormEvent) => void;
  onSync: () => void;
}) {
  const runs = runsPayload?.runs ?? [];
  const links = runsPayload?.links ?? [];
  const artifacts = artifactsPayload?.artifacts ?? [];
  const artifactRows = useMemo(() => formatArtifactRows(artifacts), [artifacts]);
  const lookupLinks = lookupPayload?.links ?? [];

  return (
    <>
      <div className="panel-title">
        <div>
          <h2>SPDD Trace</h2>
          <p className="section-help">
            Connect SPDD prompts and analysis files to the implementation runs, stable IDs, source paths, and chunks they touched.
            This catalog is metadata-backed and separate from LightRAG indexing.
          </p>
        </div>
        <div className="context-health-actions">
          <label className="stale-toggle">
            <input
              type="checkbox"
              checked={includeStaleTrace}
              onChange={(event) => onIncludeStaleTraceChange(event.target.checked)}
            />
            Include stale trace links
          </label>
          <button type="button" className="btn btn-sync-artifacts" onClick={() => void onSync()}>Sync SPDD Artifacts</button>
        </div>
      </div>
      <div className="info-grid">
        <InfoCard
          title="Artifacts"
          body="Prompt, analysis, plan, and review files discovered under spdd/. Sync refreshes titles, stable IDs, hashes, and missing/current status."
        />
        <InfoCard
          title="Runs"
          body="Explicit records of work performed from an SPDD artifact. A run explains what changed and can optionally mirror a short summary to memory."
        />
        <InfoCard
          title="Links"
          body="Durable anchors from runs to stable IDs, source paths, chunk IDs, feature labels, tool calls, or memory events."
        />
      </div>
      <div className="summary-grid">
        <Summary label="Cataloged artifacts" value={String(artifacts.length)} />
        <Summary label="Recorded runs" value={String(runs.length)} />
        <Summary label="Trace links" value={String(links.length)} />
      </div>
      <section className="trace-section">
        <div className="section-heading">
          <h3>Reverse Lookup</h3>
          <p>
            Start from something you are reviewing, such as a requirement ID or source file, and find the SPDD runs that recorded it.
            Fill one or more fields.
          </p>
        </div>
        <form className="lookup-form" onSubmit={onLookup}>
          <div className="lookup-form-grid">
            <label>
              <span>Stable ID</span>
              <input value={lookupStableId} onChange={(event) => setLookupStableId(event.target.value)} placeholder="REQ-DOMAIN-001" />
              <small>Best for requirement, task, ADR, AC, or implementation IDs.</small>
            </label>
            <label>
              <span>Source path</span>
              <input value={lookupSourcePath} onChange={(event) => setLookupSourcePath(event.target.value)} placeholder="packages/api/src/routes.ts" />
              <small>Use when asking why a file was changed.</small>
            </label>
            <label>
              <span>Chunk ID</span>
              <input value={lookupChunkId} onChange={(event) => setLookupChunkId(event.target.value)} placeholder="chunk identifier" />
              <small>Useful after retrieval; less durable than stable IDs or paths.</small>
            </label>
            <label>
              <span>Feature ref</span>
              <input value={lookupFeatureRef} onChange={(event) => setLookupFeatureRef(event.target.value)} placeholder="spdd-trace-registry" />
              <small>Use a human feature label when no stable ID exists yet.</small>
            </label>
          </div>
          <div className="lookup-form-actions">
            <button type="submit" className="btn btn-primary btn-lookup-trace">Lookup trace</button>
          </div>
        </form>
      </section>
      {runsPayload?.warnings?.length ? <div className="banner">{JSON.stringify(runsPayload.warnings)}</div> : null}
      {artifactsPayload?.warnings?.length ? <div className="banner">{JSON.stringify(artifactsPayload.warnings)}</div> : null}
      <TraceTableSection
        title="Runs"
        description="Recorded implementation or review work. Runs answer who did what, from which artifact, and with what summary."
        rows={runs}
      />
      <TraceTableSection
        title="Artifacts"
        description="Cataloged SPDD files. These rows store paths, titles, stable IDs, hashes, and status, but not full prompt content."
        rows={artifactRows}
      />
      <TraceTableSection
        title="Links"
        description="The exact targets each run referenced or implemented. Links are what make reverse lookup possible."
        rows={links}
      />
      {lookupPayload ? (
        <TraceTableSection
          title="Lookup Results"
          description="Links matching the lookup fields above. Use the run_id values here to inspect the corresponding run rows."
          rows={lookupLinks}
        />
      ) : null}
    </>
  );
}
