import { Command } from "commander";
import { createAppServices } from "@pcp/infra";
import { PlatformError } from "@pcp/core";

const services = createAppServices();
const program = new Command();

program.name("project-context");

program.command("projects")
  .argument("<action>", "add|list|delete")
  .option("--root <root>")
  .option("--project-id <project_id>")
  .option("--confirmed", "confirm destructive delete")
  .option("--delete-project-context-dir", "remove generated artifacts under .project-context")
  .action(async (action, options) => {
    if (action === "list") console.log(JSON.stringify(await services.workspaces.listWorkspaces(), null, 2));
    if (action === "add") console.log(JSON.stringify(await services.workspaces.registerWorkspace({ rootPath: options.root ?? process.cwd(), project_id: options.projectId }), null, 2));
    if (action === "delete") {
      if (!options.projectId) throw new PlatformError("VALIDATION_ERROR", "--project-id is required for delete.", { project_id: null });
      if (!options.confirmed) throw new PlatformError("CONFIRMATION_REQUIRED", undefined, { project_id: options.projectId });
      console.log(JSON.stringify(await services.projectDeletion.deleteProject(options.projectId, {
        confirmed: true,
        deleteProjectContextDir: Boolean(options.deleteProjectContextDir),
        requested_by: "cli"
      }), null, 2));
    }
  });

program.command("ingest")
  .option("--project-id <project_id>")
  .option("--changed")
  .option("--confirmed")
  .action(async (options) => {
    const workspace = await services.workspaces.resolveProjectOrActive(options.projectId);
    const result = options.changed
      ? await services.ingestion.ingestChanged(workspace.project_id)
      : await services.ingestion.ingestFull(workspace.project_id, { confirmed: Boolean(options.confirmed), requested_by: "cli" });
    console.log(JSON.stringify(result, null, 2));
  });

program.command("validate-ids")
  .option("--project-id <project_id>")
  .action(async (options) => {
    const workspace = await services.workspaces.resolveProjectOrActive(options.projectId);
    console.log(JSON.stringify(await services.ids.validateIds(workspace.project_id), null, 2));
  });

program.command("diagnostics")
  .action(async () => {
    console.log(JSON.stringify({ lightrag: await services.lightrag.ping(), graphiti: await services.graphiti.ping() }, null, 2));
  });

const multiOption = (value: string, previous?: string[]): string[] => [...(previous ?? []), value];

const spddTrace = program.command("spdd-trace").description("SPDD trace registry (metadata-backed)");

spddTrace.command("sync")
  .option("--project-id <project_id>")
  .action(async (opts: { projectId?: string }) => {
    const workspace = await services.workspaces.resolveProjectOrActive(opts.projectId);
    console.log(JSON.stringify(await services.spddTrace.syncArtifacts(workspace.project_id), null, 2));
  });

spddTrace.command("list")
  .option("--project-id <project_id>")
  .option("--stable-id <stable_id>")
  .option("--source-path <source_path>")
  .option("--chunk-id <chunk_id>")
  .option("--feature-ref <feature_ref>")
  .option("--include-stale")
  .option("--limit <limit>")
  .action(async (opts: { projectId?: string; stableId?: string; sourcePath?: string; chunkId?: string; featureRef?: string; includeStale?: boolean; limit?: string }) => {
    const workspace = await services.workspaces.resolveProjectOrActive(opts.projectId);
    const limParsed = opts.limit ? Number(opts.limit) : Number.NaN;
    const lim = Number.isFinite(limParsed) ? Math.min(200, Math.max(1, limParsed)) : undefined;
    console.log(JSON.stringify(await services.spddTrace.listTrace(workspace.project_id, {
      stable_id: opts.stableId,
      source_path: opts.sourcePath,
      chunk_id: opts.chunkId,
      feature_ref: opts.featureRef,
      include_stale: Boolean(opts.includeStale),
      limit: lim
    }), null, 2));
  });

spddTrace.command("record")
  .requiredOption("--artifact-path <path>")
  .requiredOption("--summary <summary>")
  .option("--project-id <project_id>")
  .option("--stable-id <id>", "Stable ID (repeat flag for multiple)", multiOption, [] as string[])
  .option("--source-path <path>", "Source path (repeat)", multiOption, [] as string[])
  .option("--chunk-id <id>", "Chunk ID (repeat)", multiOption, [] as string[])
  .option("--feature-ref <ref>", "Feature ref (repeat)", multiOption, [] as string[])
  .option("--mirror-to-memory")
  .action(async (opts: {
    artifactPath: string;
    summary: string;
    projectId?: string;
    stableId?: string[];
    sourcePath?: string[];
    chunkId?: string[];
    featureRef?: string[];
    mirrorToMemory?: boolean;
  }) => {
    const workspace = await services.workspaces.resolveProjectOrActive(opts.projectId);
    console.log(JSON.stringify(await services.spddTrace.recordRun(workspace.project_id, {
      artifact_path: opts.artifactPath,
      summary: opts.summary,
      stable_ids: opts.stableId?.length ? opts.stableId : undefined,
      source_paths: opts.sourcePath?.length ? opts.sourcePath : undefined,
      chunk_ids: opts.chunkId?.length ? opts.chunkId : undefined,
      feature_refs: opts.featureRef?.length ? opts.featureRef : undefined,
      mirror_to_memory: Boolean(opts.mirrorToMemory)
    }), null, 2));
  });

try {
  await program.parseAsync();
} catch (err) {
  const mapped = PlatformError.mapUnknown(err);
  console.error(JSON.stringify(mapped.toJson(), null, 2));
  process.exitCode = mapped.httpStatus >= 500 ? 2 : 1;
}
