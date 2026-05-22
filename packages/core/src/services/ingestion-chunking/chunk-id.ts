import { createHash } from "node:crypto";
import type { ChunkKind } from "../../domain/types.js";

export function deterministicChunkId(
  project_id: string,
  source_path: string,
  kind: ChunkKind,
  line_start: number,
  line_end: number,
  heading: string | undefined,
  stable_ids: string[]
): string {
  const sorted = [...stable_ids].sort();
  const parts = [project_id, source_path, kind, String(line_start), String(line_end), heading ?? "", ...sorted];
  return createHash("sha256").update(parts.join("\u001e"), "utf8").digest("hex");
}

export function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
