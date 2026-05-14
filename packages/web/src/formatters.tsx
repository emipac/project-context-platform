import type { ReactNode } from "react";

export function formatCell(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.length > 3 ? `${value.length} items` : value.map(formatCell).join(", ");
  if (typeof value === "string" && isIsoDateTime(value)) return formatDateTime(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + " " + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(":");
}

export function renderCell(value: unknown): ReactNode {
  const text = formatCell(value);
  if (text.length <= 260) return text;
  return <span title={text}>{text.slice(0, 260)}...</span>;
}

export function formatHeaderLabel(key: string): string {
  const labels: Record<string, string> = {
    artifact_id: "Artifact ID",
    artifact_path: "Artifact Path",
    artifact_type: "Type",
    call_id: "Call ID",
    chunk_id: "Chunk ID",
    completed_at: "Completed",
    content_hash: "Content Hash",
    created_at: "Created",
    feature_ref: "Feature Ref",
    first_seen_at: "First Seen",
    job_id: "Job ID",
    last_seen_at: "Last Seen",
    line_start: "Line",
    link_id: "Link ID",
    memory_event_id: "Memory Event",
    project_id: "Project",
    run_id: "Run ID",
    source_path: "Source Path",
    stable_id: "Stable ID",
    stable_ids: "Stable IDs",
    target_id: "Target",
    target_type: "Target Type",
    tool_call_ids: "Tool Calls",
    updated_at: "Updated"
  };
  return labels[key] ?? key
    .split("_")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

export function isLongCell(key: string, value: unknown): boolean {
  return key === "content" || formatCell(value).length > 260;
}

export function nextSort(current: { key: string; direction: "asc" | "desc" } | null, key: string): { key: string; direction: "asc" | "desc" } | null {
  if (current?.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

export function compareCells(left: unknown, right: unknown, direction: "asc" | "desc"): number {
  const leftText = formatCell(left);
  const rightText = formatCell(right);
  const leftNumber = Number(leftText);
  const rightNumber = Number(rightText);
  const result = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? leftNumber - rightNumber
    : leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

export function formatArtifactRows(rows: unknown[]): Record<string, unknown>[] {
  return rows
    .map((row) => row as Record<string, unknown>)
    .sort(compareArtifactRowsNewestFirst)
    .map((artifact) => ({
      created_at: artifact.first_seen_at,
      updated_at: artifact.last_seen_at,
      artifact_type: artifact.artifact_type,
      source_path: artifact.source_path,
      title: artifact.title,
      stable_ids: artifact.stable_ids,
      status: artifact.status,
      content_hash: artifact.content_hash,
      artifact_id: artifact.artifact_id,
      project_id: artifact.project_id
    }));
}

export function compareArtifactRowsNewestFirst(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftCreated = String(left.first_seen_at ?? left.created_at ?? "");
  const rightCreated = String(right.first_seen_at ?? right.created_at ?? "");
  const created = rightCreated.localeCompare(leftCreated);
  if (created !== 0) return created;
  const leftUpdated = String(left.last_seen_at ?? left.updated_at ?? "");
  const rightUpdated = String(right.last_seen_at ?? right.updated_at ?? "");
  const updated = rightUpdated.localeCompare(leftUpdated);
  if (updated !== 0) return updated;
  return String(right.source_path ?? "").localeCompare(String(left.source_path ?? ""));
}
