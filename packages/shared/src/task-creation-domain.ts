import type { CloudRunSource, PrAuthorshipMode } from "./cloud";
import type { Task } from "./domain-types";
import type { ExecutionMode } from "./exec-types";
import type { WorkspaceMode } from "./workspace";
import type { Workspace } from "./workspace-domain";

// Host-agnostic input/output for the task-creation flow. The renderer
// TaskCreationSaga owns the orchestration; these are the plain data shapes its
// consumers (inbox direct-create hooks, deep-link open, task-input) pass and
// receive. Lives in shared so packages/ui can consume them without importing
// the renderer saga.
export interface TaskCreationInput {
  // For opening existing task
  taskId?: string;
  // For creating new task (required if no taskId)
  content?: string;
  taskDescription?: string;
  filePaths?: string[];
  repoPath?: string;
  repository?: string | null;
  workspaceMode?: WorkspaceMode;
  branch?: string | null;
  githubIntegrationId?: number;
  githubUserIntegrationId?: string;
  executionMode?: ExecutionMode;
  adapter?: "claude" | "codex";
  model?: string;
  reasoningLevel?: string;
  environmentId?: string;
  sandboxEnvironmentId?: string;
  cloudPrAuthorshipMode?: PrAuthorshipMode;
  cloudRunSource?: CloudRunSource;
  signalReportId?: string;
  additionalDirectories?: string[];
}

export interface TaskCreationOutput {
  task: Task;
  workspace: Workspace | null;
}
