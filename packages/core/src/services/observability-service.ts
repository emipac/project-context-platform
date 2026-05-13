import { randomUUID } from "node:crypto";
import type { ToolCallLogEntry, ToolCallLogger } from "../index.js";

export class ObservabilityService {
  constructor(private readonly logger: ToolCallLogger) {}

  async recordToolCall(input: Omit<ToolCallLogEntry, "call_id" | "created_at">): Promise<ToolCallLogEntry> {
    const entry: ToolCallLogEntry = {
      ...input,
      call_id: randomUUID(),
      created_at: new Date().toISOString()
    };
    await this.logger.append(entry);
    return entry;
  }
}
