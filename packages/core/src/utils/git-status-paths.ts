import { spawnSync } from "node:child_process";

/**
 * Non-destructive read of modified/untracked paths via `git status --porcelain=v1`.
 * Paths are repo-relative POSIX paths when parsing succeeds.
 */
export function gitWorkingTreePaths(repoRoot: string): { ok: true; paths: string[] } | { ok: false; reason: string } {
  const result = spawnSync("git", ["status", "--porcelain=v1"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.error) {
    return { ok: false, reason: result.error.message };
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    return { ok: false, reason: stderr || `git exited with status ${result.status ?? "unknown"}` };
  }
  const out = String(result.stdout ?? "");
  const paths: string[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line || line.length < 4) continue;
    const slice = line.slice(3).trim();
    if (!slice) continue;
    if (slice.includes(" -> ")) paths.push(slice.split(" -> ").pop()!.trim());
    else paths.push(slice);
  }
  const unique = new Set<string>();
  for (const raw of paths) {
    const norm = raw.replaceAll("\\", "/").replace(/^["']|["']$/g, "");
    if (!norm || norm.startsWith("../")) continue;
    unique.add(norm);
  }
  return { ok: true, paths: [...unique] };
}
