import type { TaskRunStatus } from "@posthog/shared/domain-types";
import type { PrCiStatus, PrSnapshotState } from "./prSnapshot";

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
  ciStatus?: PrCiStatus | null;
}): TaskBoardStatus {
  if (input.prState === "merged") return "done";
  if (input.prState === "closed") return "cancelled";
  if (input.runStatus === "failed" || input.runStatus === "cancelled") {
    return "cancelled";
  }
  if (input.prState === "open" && input.ciStatus === "passing") {
    return "in_review";
  }
  return "working";
}
