import type { ChangedFile, Task } from "@posthog/shared/domain-types";

export interface CloudRunSessionLike {
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

  const cloudStatus = session?.cloudStatus ?? task.latest_run?.status ?? null;
  const isRunActive =
    cloudStatus === "queued" ||
    cloudStatus === "in_progress" ||
    (cloudStatus === null && session != null);

  return { prUrl, effectiveBranch, repo, cloudStatus, isRunActive };
}

export type { ChangedFile };
