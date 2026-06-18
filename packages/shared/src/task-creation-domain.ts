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
  // When the branch exists only on the remote, opt in to fetching and checking
  // it out locally into the worktree (set after the user confirms).
  allowRemoteBranchCheckout?: boolean;
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
  /**
   * CONTEXT.md of the channel a task was created in, if any. Appended to the
   * agent's initial prompt as optional background — reference material the
   * agent may draw on, not instructions it must follow.
   */
  channelContext?: string;
  /** Display name of that channel, embedded in the context block for the UI. */
  channelName?: string;
}

export interface TaskCreationOutput {
  task: Task;
  workspace: Workspace | null;
}
