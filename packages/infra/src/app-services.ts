import {
  ContextComposerService,
  GlobalRegistryStore,
  IdRegistryService,
  IngestionService,
  ObservabilityService,
  ProjectDeletionService,
  ProjectWorkspaceService,
  RetrievalService,
  TemporalMemoryService,
  ValidationService
} from "@pcp/core";
import { LocalGraphitiAdapter } from "./local-graphiti-adapter.js";
import { LocalLightRagAdapter } from "./local-lightrag-adapter.js";
import { ProjectMetadataRepository } from "./project-metadata-repository.js";
import { ProjectToolCallLogger } from "./project-tool-call-logger.js";
import { GraphitiHttpAdapter } from "./http/graphiti-http-adapter.js";
import { LightRagHttpAdapter } from "./http/lightrag-http-adapter.js";

export function createAppServices() {
  const registry = new GlobalRegistryStore();
  const workspaces = new ProjectWorkspaceService(registry);
  const repository = new ProjectMetadataRepository(workspaces);
  const useLocalAdapters = process.env.PCP_ADAPTER_MODE === "local";
  const lightrag = useLocalAdapters ? new LocalLightRagAdapter(workspaces, repository) : new LightRagHttpAdapter();
  const graphiti = useLocalAdapters ? new LocalGraphitiAdapter() : new GraphitiHttpAdapter();
  const toolCalls = new ProjectToolCallLogger(workspaces);
  const projectDeletion = new ProjectDeletionService(workspaces, repository, lightrag, graphiti);
  return {
    registry,
    workspaces,
    repository,
    lightrag,
    graphiti,
    projectDeletion,
    adapterMode: useLocalAdapters ? "local" : "http",
    toolCalls,
    ids: new IdRegistryService(repository),
    ingestion: new IngestionService(workspaces, lightrag, repository),
    retrieval: new RetrievalService(workspaces, lightrag),
    memory: new TemporalMemoryService(workspaces, graphiti),
    composer: new ContextComposerService(workspaces, lightrag, graphiti),
    validation: new ValidationService(workspaces),
    observability: new ObservabilityService(toolCalls)
  };
}
