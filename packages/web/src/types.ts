export interface Workspace {
  project_id: string;
  name: string;
  rootPath: string;
  status: string;
}

export type TabId =
  | "projects"
  | "ingestion"
  | "documents"
  | "ids"
  | "search"
  | "memory"
  | "approvals"
  | "logs"
  | "contextHealth"
  | "spddTrace"
  | "settings";

export interface SpddTraceBundle {
  artifacts: unknown[];
  runs: unknown[];
  links: unknown[];
  warnings: unknown[];
}

export interface SpddArtifactsPayload {
  artifacts: unknown[];
  warnings: unknown[];
}
