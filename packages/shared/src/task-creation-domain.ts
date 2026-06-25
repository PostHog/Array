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
  // When a worktree is already checked out on the branch, opt in to reusing it
  // for this task instead of creating a new one (set after the user confirms).
  reuseExistingWorktree?: boolean;
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
  /**
   * The user's saved personalization (Settings → Personalization custom
   * instructions). Cloud-only: local tasks already receive these through the
   * workspace-server system prompt, so the saga folds this into the cloud run's
   * first message instead, to avoid double-injecting.
   */
  customInstructions?: string;
  /**
   * When true, the task may be created without a repo/branch. Used by the
   * channels "generic chat box": the agent decides at runtime whether it needs
   * a repo and attaches one lazily. A local session still starts, in a scratch
   * working directory, so non-code tasks (analysis, email) can run repo-less.
   */
  allowNoRepo?: boolean;
  // Label of the Home-tab quick action that started this run (e.g. "Fix CI"), so the
  // workstream can show which quick actions have been run against it.
  homeQuickActionLabel?: string;
}

export interface TaskCreationOutput {
  task: Task;
  workspace: Workspace | null;
}
