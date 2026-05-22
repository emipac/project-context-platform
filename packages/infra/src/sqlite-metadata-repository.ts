import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CanonicalDocumentChunk,
  IdRegistryEntry,
  IngestionJob,
  MetadataRepository,
  SpddArtifact,
  SpddTraceFilter,
  SpddTraceLink,
  SpddWorkRun
} from "@pcp/core";

export class SqliteMetadataRepository implements MetadataRepository {
  private readonly db: DatabaseSync;

  constructor(metadataPath = process.env.PCP_METADATA_PATH ?? ".project-context/metadata.sqlite") {
    const fullPath = resolve(metadataPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    this.db = new DatabaseSync(fullPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ingestion_jobs (
        project_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, job_id)
      );
      CREATE TABLE IF NOT EXISTS chunks (
        project_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, chunk_id)
      );
      CREATE TABLE IF NOT EXISTS id_registry (
        project_id TEXT NOT NULL,
        stable_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        line_start INTEGER,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, stable_id, source_path, line_start)
      );
      CREATE TABLE IF NOT EXISTS spdd_artifacts (
        project_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, artifact_id)
      );
      CREATE TABLE IF NOT EXISTS spdd_work_runs (
        project_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        artifact_id TEXT,
        status TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (project_id, run_id)
      );
      CREATE TABLE IF NOT EXISTS spdd_trace_links (
        project_id TEXT NOT NULL,
        link_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, link_id)
      );
      CREATE INDEX IF NOT EXISTS idx_spdd_artifacts_project_source ON spdd_artifacts(project_id, source_path);
      CREATE INDEX IF NOT EXISTS idx_spdd_runs_project_artifact ON spdd_work_runs(project_id, artifact_id);
      CREATE INDEX IF NOT EXISTS idx_spdd_runs_project_completed ON spdd_work_runs(project_id, completed_at);
      CREATE INDEX IF NOT EXISTS idx_spdd_links_project_run ON spdd_trace_links(project_id, run_id);
      CREATE INDEX IF NOT EXISTS idx_spdd_links_project_target ON spdd_trace_links(project_id, target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_spdd_links_project_status ON spdd_trace_links(project_id, status);
    `);
  }

  async saveJob(job: IngestionJob): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO ingestion_jobs (project_id, job_id, payload, created_at)
      VALUES (?, ?, ?, ?)
    `).run(job.project_id, job.job_id, JSON.stringify(job), job.started_at);
  }

  async getJob(project_id: string, job_id: string): Promise<IngestionJob | undefined> {
    const row = this.db.prepare("SELECT payload FROM ingestion_jobs WHERE project_id = ? AND job_id = ?").get(project_id, job_id) as unknown as Row | undefined;
    return row ? JSON.parse(row.payload) as IngestionJob : undefined;
  }

  async listRecentJobs(project_id: string): Promise<IngestionJob[]> {
    return this.db.prepare("SELECT payload FROM ingestion_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50")
      .all(project_id)
      .map((row) => JSON.parse((row as unknown as Row).payload) as IngestionJob);
  }

  async saveChunks(project_id: string, chunks: CanonicalDocumentChunk[]): Promise<void> {
    const statement = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (project_id, chunk_id, source_path, status, payload, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN");
    try {
      for (const chunk of chunks) statement.run(project_id, chunk.chunk_id, chunk.source_path, chunk.status, JSON.stringify(chunk), chunk.updated_at);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async listChunks(project_id: string): Promise<CanonicalDocumentChunk[]> {
    return this.db.prepare("SELECT payload FROM chunks WHERE project_id = ? ORDER BY source_path").all(project_id)
      .map((row) => JSON.parse((row as unknown as Row).payload) as CanonicalDocumentChunk);
  }

  async markStaleChunksForPaths(project_id: string, paths: string[], reason = "deleted"): Promise<void> {
    const chunks = await this.listChunks(project_id);
    const registry = await this.listRegistryEntries(project_id);
    await this.saveChunks(project_id, chunks
      .filter((chunk) => paths.includes(chunk.source_path))
      .map((chunk) => ({ ...chunk, status: "stale", stale_reason: reason, updated_at: new Date().toISOString() })));
    await this.saveRegistryEntries(project_id, registry
      .filter((entry) => paths.includes(entry.source_path))
      .map((entry) => ({ ...entry, status: "stale", stale_reason: reason as IdRegistryEntry["stale_reason"], last_seen_at: new Date().toISOString() })));
  }

  async markStaleDocumentChunksForPaths(project_id: string, paths: string[], reason = "replaced"): Promise<void> {
    const chunks = await this.listChunks(project_id);
    const stale = chunks
      .filter((chunk) => paths.includes(chunk.source_path) && chunk.status === "current")
      .map((chunk) => ({ ...chunk, status: "stale" as const, stale_reason: reason, updated_at: new Date().toISOString() }));
    if (stale.length) await this.saveChunks(project_id, stale);
  }

  async markStaleRegistryEntriesExceptPaths(project_id: string, activePaths: string[], reason = "moved"): Promise<void> {
    const active = new Set(activePaths);
    const registry = await this.listRegistryEntries(project_id);
    await this.saveRegistryEntries(project_id, registry
      .filter((entry) => !active.has(entry.source_path) && entry.status !== "stale")
      .map((entry) => ({ ...entry, status: "stale", stale_reason: reason as IdRegistryEntry["stale_reason"], last_seen_at: new Date().toISOString() })));
  }

  async saveRegistryEntries(project_id: string, entries: IdRegistryEntry[]): Promise<void> {
    const statement = this.db.prepare(`
      INSERT OR REPLACE INTO id_registry (project_id, stable_id, source_path, line_start, status, payload, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN");
    try {
      for (const entry of entries) {
        statement.run(project_id, entry.stable_id, entry.source_path, entry.line_start ?? null, entry.status, JSON.stringify(entry), entry.last_seen_at);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async listRegistryEntries(project_id: string): Promise<IdRegistryEntry[]> {
    return this.db.prepare("SELECT payload FROM id_registry WHERE project_id = ? ORDER BY stable_id, source_path").all(project_id)
      .map((row) => JSON.parse((row as unknown as Row).payload) as IdRegistryEntry);
  }

  async saveSpddArtifacts(project_id: string, artifacts: SpddArtifact[]): Promise<void> {
    const statement = this.db.prepare(`
      INSERT OR REPLACE INTO spdd_artifacts (project_id, artifact_id, source_path, artifact_type, status, payload, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN");
    try {
      for (const artifact of artifacts) {
        statement.run(
          project_id,
          artifact.artifact_id,
          artifact.source_path,
          artifact.artifact_type,
          artifact.status,
          JSON.stringify(artifact),
          artifact.last_seen_at
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async listSpddArtifacts(project_id: string, filter?: SpddTraceFilter): Promise<SpddArtifact[]> {
    let sql = "SELECT payload FROM spdd_artifacts WHERE project_id = ?";
    const sqlParams: (string | number | null)[] = [project_id];
    if (filter?.artifact_type) {
      sql += " AND artifact_type = ?";
      sqlParams.push(filter.artifact_type);
    }
    if (filter?.artifact_id) {
      sql += " AND artifact_id = ?";
      sqlParams.push(filter.artifact_id);
    }
    if (filter?.artifact_path) {
      sql += " AND source_path = ?";
      sqlParams.push(filter.artifact_path);
    }
    if (!filter?.include_stale) {
      sql += " AND status = ?";
      sqlParams.push("current");
    }
    sql += " ORDER BY updated_at DESC";
    let rows = this.db.prepare(sql).all(...sqlParams).map((row) => JSON.parse((row as unknown as Row).payload) as SpddArtifact);
    if (filter?.stable_id) rows = rows.filter((artifact) => artifact.stable_ids.includes(filter.stable_id!));
    rows.sort(compareSpddArtifactsNewestFirst);
    const lim = clampSpddLimit(filter?.limit);
    return rows.slice(0, lim);
  }

  async saveSpddWorkRun(run: SpddWorkRun): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO spdd_work_runs (project_id, run_id, artifact_id, status, completed_at, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(run.project_id, run.run_id, run.artifact_id ?? null, run.status, run.completed_at, JSON.stringify(run));
  }

  async listSpddWorkRuns(project_id: string, filter?: SpddTraceFilter): Promise<SpddWorkRun[]> {
    let sql = "SELECT payload FROM spdd_work_runs WHERE project_id = ?";
    const sqlParams: (string | number | null)[] = [project_id];
    if (filter?.run_id) {
      sql += " AND run_id = ?";
      sqlParams.push(filter.run_id);
    }
    if (filter?.artifact_id) {
      sql += " AND artifact_id = ?";
      sqlParams.push(filter.artifact_id);
    }
    sql += " ORDER BY completed_at DESC";
    let rows = this.db.prepare(sql).all(...sqlParams).map((row) => JSON.parse((row as unknown as Row).payload) as SpddWorkRun);
    if (filter?.artifact_path) rows = rows.filter((run) => run.artifact_path === filter.artifact_path);
    const lim = clampSpddLimit(filter?.limit);
    return rows.slice(0, lim);
  }

  async saveSpddTraceLinks(project_id: string, links: SpddTraceLink[]): Promise<void> {
    const statement = this.db.prepare(`
      INSERT OR REPLACE INTO spdd_trace_links (project_id, link_id, run_id, target_type, target_id, relation, status, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN");
    try {
      for (const link of links) {
        statement.run(
          project_id,
          link.link_id,
          link.run_id,
          link.target_type,
          link.target_id,
          link.relation,
          link.status,
          JSON.stringify(link),
          link.created_at
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async listSpddTraceLinks(project_id: string, filter?: SpddTraceFilter): Promise<SpddTraceLink[]> {
    let sql = "SELECT payload FROM spdd_trace_links WHERE project_id = ?";
    const sqlParams: (string | number | null)[] = [project_id];
    if (filter?.run_id) {
      sql += " AND run_id = ?";
      sqlParams.push(filter.run_id);
    }
    if (filter?.target_type && filter?.target_id) {
      sql += " AND target_type = ? AND target_id = ?";
      sqlParams.push(filter.target_type, filter.target_id);
    }
    if (!filter?.include_stale) sql += " AND status != 'stale'";
    sql += " ORDER BY created_at DESC";
    let rows = this.db.prepare(sql).all(...sqlParams).map((row) => JSON.parse((row as unknown as Row).payload) as SpddTraceLink);
    if (filter?.stable_id) {
      rows = rows.filter(
        (link) =>
          (link.target_type === "stable_id" && link.target_id === filter.stable_id) ||
          link.stable_id === filter.stable_id
      );
    }
    if (filter?.source_path) {
      rows = rows.filter(
        (link) =>
          (link.target_type === "source_path" && link.target_id === filter.source_path) ||
          link.source_path === filter.source_path
      );
    }
    if (filter?.chunk_id) {
      rows = rows.filter(
        (link) =>
          (link.target_type === "chunk" && link.target_id === filter.chunk_id) ||
          link.chunk_id === filter.chunk_id
      );
    }
    if (filter?.feature_ref) rows = rows.filter((link) => link.target_type === "feature" && link.target_id === filter.feature_ref);
    const lim = clampSpddLimit(filter?.limit);
    return rows.slice(0, lim);
  }

  async deleteProject(project_id: string): Promise<void> {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM ingestion_jobs WHERE project_id = ?").run(project_id);
      this.db.prepare("DELETE FROM chunks WHERE project_id = ?").run(project_id);
      this.db.prepare("DELETE FROM id_registry WHERE project_id = ?").run(project_id);
      this.db.prepare("DELETE FROM spdd_artifacts WHERE project_id = ?").run(project_id);
      this.db.prepare("DELETE FROM spdd_work_runs WHERE project_id = ?").run(project_id);
      this.db.prepare("DELETE FROM spdd_trace_links WHERE project_id = ?").run(project_id);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

interface Row {
  payload: string;
}

function clampSpddLimit(limit?: number): number {
  const n = limit ?? 100;
  return Math.min(200, Math.max(1, n));
}

function compareSpddArtifactsNewestFirst(left: SpddArtifact, right: SpddArtifact): number {
  const created = right.first_seen_at.localeCompare(left.first_seen_at);
  if (created !== 0) return created;
  const updated = right.last_seen_at.localeCompare(left.last_seen_at);
  if (updated !== 0) return updated;
  return right.source_path.localeCompare(left.source_path);
}
