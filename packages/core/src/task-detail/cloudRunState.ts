import {
  type ChangedFile,
  isTerminalStatus,
  type Task,
} from "@posthog/shared/domain-types";

export interface CloudRunSessionLike {
  taskRunId?: string | null;
  cloudBranch?: string | null;
  cloudStatus?: string | null;
}

export interface CloudRunStateResult {
  prUrl: string | null;
  effectiveBranch: string | null;
  repo: string | null;
  cloudStatus: string | null;
  isRunActive: boolean;
}

export function deriveCloudRunState(
  task: Task,
  session: CloudRunSessionLike | null | undefined,
  prUrl: string | null,
): CloudRunStateResult {
  const branch = task.latest_run?.branch ?? null;
  const cloudBranch = session?.cloudBranch ?? null;
  const effectiveBranch = branch ?? cloudBranch;
  const repo = task.repository ?? null;

  const taskRunId = task.latest_run?.id;
  const taskRunStatus = task.latest_run?.status ?? null;
  const sessionMatchesLatestRun =
    !!taskRunId && session?.taskRunId === taskRunId;
  const cloudStatus = sessionMatchesLatestRun
    ? isTerminalStatus(taskRunStatus)
      ? taskRunStatus
      : (session?.cloudStatus ?? taskRunStatus)
    : (taskRunStatus ?? session?.cloudStatus ?? null);
  const isRunActive =
    cloudStatus === "queued" ||
    cloudStatus === "in_progress" ||
    (cloudStatus === null && session != null);

  return { prUrl, effectiveBranch, repo, cloudStatus, isRunActive };
}

export type { ChangedFile };
