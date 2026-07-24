import type { TaskRunStatus } from "@posthog/shared/domain-types";
import type { PrSnapshot, PrSnapshotState } from "./prSnapshot";

export const TASK_BOARD_STATUSES = [
  "working",
  "in_review",
  "done",
  "cancelled",
] as const;
export type TaskBoardStatus = (typeof TASK_BOARD_STATUSES)[number];

/**
 * General task-board lifecycle. PR truth takes precedence over the run because
 * run status commonly becomes stale after a PR is opened or merged.
 */
export function taskBoardStatus(input: {
  runStatus?: TaskRunStatus | null;
  prState?: PrSnapshotState | null;
}): TaskBoardStatus {
  if (input.prState === "merged") return "done";
  if (input.prState === "closed") return "cancelled";
  if (input.runStatus === "failed" || input.runStatus === "cancelled") {
    return "cancelled";
  }
  if (input.prState === "open") return "in_review";
  return "working";
}

export function taskBoardStatusFromSources(input: {
  runStatus?: TaskRunStatus | null;
  resolvedPrState?: PrSnapshotState | null;
  prSnapshot?: PrSnapshot | null;
}): TaskBoardStatus {
  return taskBoardStatus({
    runStatus: input.runStatus,
    // Direct PR resolution is fresher than the periodically rebuilt Home row.
    prState: input.resolvedPrState ?? input.prSnapshot?.state,
  });
}
