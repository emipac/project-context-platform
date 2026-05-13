import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CanonicalDocumentChunk, IdRegistryEntry, IngestionJob, MetadataRepository } from "@pcp/core";

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

  async deleteProject(project_id: string): Promise<void> {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM ingestion_jobs WHERE project_id = ?").run(project_id);
      this.db.prepare("DELETE FROM chunks WHERE project_id = ?").run(project_id);
      this.db.prepare("DELETE FROM id_registry WHERE project_id = ?").run(project_id);
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
