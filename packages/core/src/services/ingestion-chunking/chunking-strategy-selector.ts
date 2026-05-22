import { FileLevelChunkingStrategy } from "./file-level-chunking-strategy.js";
import type { IngestionChunkingStrategy } from "./ingestion-chunking-types.js";
import { MarkdownChunkingStrategy } from "./markdown-chunking-strategy.js";
import { PlatformError } from "../../errors/platform-error.js";

export class ChunkingStrategySelector {
  private readonly strategies: IngestionChunkingStrategy[];

  constructor() {
    this.strategies = [new MarkdownChunkingStrategy(), new FileLevelChunkingStrategy()];
  }

  select(path: string): IngestionChunkingStrategy {
    const strategy = this.strategies.find((s) => s.supports(path));
    if (!strategy) {
      throw new PlatformError("VALIDATION_ERROR", "No ingestion chunking strategy matches path.", {
        project_id: null,
        details: { path }
      });
    }
    return strategy;
  }
}
