import type { TabId } from "./types.js";

export const tabs: Array<{ id: TabId; label: string }> = [
  { id: "projects", label: "Projects" },
  { id: "ingestion", label: "Ingestion" },
  { id: "documents", label: "Document Index" },
  { id: "ids", label: "ID Registry" },
  { id: "search", label: "Search" },
  { id: "memory", label: "Memory" },
  { id: "approvals", label: "Approvals" },
  { id: "logs", label: "Tool Call Logs" },
  { id: "spddTrace", label: "SPDD Trace" },
  { id: "settings", label: "Settings" }
];
