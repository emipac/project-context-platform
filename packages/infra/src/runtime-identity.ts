import process from "node:process";
import type { RuntimeIdentityDTO } from "@pcp/core";

export function createRuntimeIdentity(adapterMode: string): RuntimeIdentityDTO {
  const dto: RuntimeIdentityDTO = {
    generated_at: new Date().toISOString(),
    node_version: process.version,
    platform: `${process.platform}/${process.arch}`,
    pid: process.pid,
    cwd: process.cwd(),
    adapter_mode: adapterMode
  };
  const rev = process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.CI_COMMIT_SHA;
  if (rev?.trim()) dto.build_revision = rev.trim();
  return dto;
}
