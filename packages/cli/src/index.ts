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

try {
  await program.parseAsync();
} catch (err) {
  const mapped = PlatformError.mapUnknown(err);
  console.error(JSON.stringify(mapped.toJson(), null, 2));
  process.exitCode = mapped.httpStatus >= 500 ? 2 : 1;
}
