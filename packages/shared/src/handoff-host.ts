import type { GitHandoffCheckpoint, HandoffLocalGitState } from "./git-handoff";
import type { WorkspaceMode } from "./workspace";

export interface HandoffApiContext {
  apiHost: string;
  teamId: number;
}

export interface HandoffChangedFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  linesAdded?: number;
  linesRemoved?: number;
}

export interface HandoffReconnectParams {
  taskId: string;
  taskRunId: string;
  repoPath: string;
  apiHost: string;
  projectId: number;
  logUrl: string;
  sessionId?: string;
  adapter?: "claude" | "codex";
}

export interface HandoffResumeStateResult {
  resumeState: {
    conversation: unknown[];
    latestGitCheckpoint: GitHandoffCheckpoint | null;
  };
  cloudLogUrl: string | null;
}

/**
 * Host capabilities the core handoff orchestration depends on. The
 * implementation lives in workspace-server (agent runtime, workspace/repository
 * repos, git, local log cache, divergence dialog); core only orchestrates over
 * this port. Declared in shared so core and workspace-server can both reference
 * it without importing each other.
 */
export interface HandoffHost {
  getChangedFiles(repoPath: string): Promise<readonly HandoffChangedFile[]>;
  getLocalGitState(repoPath: string): Promise<HandoffLocalGitState>;

  markRunEnvironmentLocal(
    ctx: HandoffApiContext,
    taskId: string,
    runId: string,
  ): Promise<void>;
  fetchResumeState(
    ctx: HandoffApiContext,
    taskId: string,
    runId: string,
  ): Promise<HandoffResumeStateResult>;
  formatConversation(conversation: unknown[]): string;
  applyGitCheckpoint(
    ctx: HandoffApiContext,
    checkpoint: GitHandoffCheckpoint,
    repoPath: string,
    taskId: string,
    runId: string,
    localGitState?: HandoffLocalGitState,
  ): Promise<void>;
  reconnectSession(
    params: HandoffReconnectParams,
  ): Promise<{ sessionId: string } | null>;
  attachWorkspaceToFolder(
    taskId: string,
    repoPath: string,
  ): { revert: () => void };
  seedLocalLogs(runId: string, logUrl: string): Promise<void>;
  /**
   * After a cloud→local handoff, parse every GIT_CHECKPOINT notification in the
   * run log (local cache first, S3 fallback), materialize each cloud checkpoint's
   * git ref locally, and register it in the session so restore is available for
   * every cloud turn.
   */
  syncCloudCheckpoints(
    ctx: HandoffApiContext,
    taskId: string,
    runId: string,
    repoPath: string,
  ): Promise<void>;
  setPendingContext(taskRunId: string, context: string): void;
  killSession(taskRunId: string): Promise<void>;
  updateWorkspaceMode(taskId: string, mode: WorkspaceMode): void;

  captureGitCheckpoint(
    ctx: HandoffApiContext,
    repoPath: string,
    taskId: string,
    runId: string,
    localGitState?: HandoffLocalGitState,
  ): Promise<GitHandoffCheckpoint | null>;
  persistCheckpointToLog(
    ctx: HandoffApiContext,
    taskId: string,
    runId: string,
    checkpoint: GitHandoffCheckpoint,
  ): Promise<void>;
  /**
   * Packs every prior local checkpoint (all but the one just captured) and
   * appends them to the cloud run log, so they survive a later cloud→local
   * handoff and remain restorable.
   */
  uploadPriorLocalCheckpoints(
    ctx: HandoffApiContext,
    taskId: string,
    runId: string,
    repoPath: string,
    currentCheckpoint: GitHandoffCheckpoint | null,
    baseline?: string | null,
  ): Promise<void>;
  countLocalLogEntries(runId: string): Promise<number>;
  resumeRunInCloud(
    ctx: HandoffApiContext,
    taskId: string,
    runId: string,
  ): Promise<void>;
  cleanupLocalAfterCloudHandoff(
    repoPath: string,
    branchName: string | null,
  ): Promise<void>;
  deleteLocalLogCache(runId: string): Promise<void>;
}
