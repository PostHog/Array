import type { CloudRunSource, PrAuthorshipMode } from "@posthog/shared";
import type { Task, TaskRun } from "@posthog/shared/domain-types";

export interface CreateTaskRunClientOptions {
  environment?: "local" | "cloud";
  mode?: "interactive" | "background";
  branch?: string | null;
  adapter?: "claude" | "codex";
  model?: string;
  reasoningLevel?: string;
  sandboxEnvironmentId?: string;
  prAuthorshipMode?: PrAuthorshipMode;
  runSource?: CloudRunSource;
  signalReportId?: string;
  initialPermissionMode?: string;
  homeQuickAction?: string;
}

export interface StartTaskRunClientOptions {
  pendingUserMessage?: string;
  pendingUserArtifactIds?: string[];
}

export interface TaskCreationApiClient {
  getTask(taskId: string): Promise<Task>;
  getTaskRun(taskId: string, runId: string): Promise<TaskRun>;
  createTask(options: Record<string, unknown>): Promise<unknown>;
  deleteTask(taskId: string): Promise<void>;
  createTaskRun(
    taskId: string,
    options?: CreateTaskRunClientOptions,
  ): Promise<TaskRun>;
  startTaskRun(
    taskId: string,
    runId: string,
    options?: StartTaskRunClientOptions,
  ): Promise<Task>;
}
