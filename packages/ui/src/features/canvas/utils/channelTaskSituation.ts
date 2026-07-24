import type { SituationId } from "@posthog/core/workflow/schemas";
import type { Task } from "@posthog/shared/domain-types";

/**
 * Fallback for channel tasks outside the current user's Home snapshot. Home's
 * computed workstream situation always wins; this only mirrors the two states
 * that can be determined from the task payload alone.
 */
export function fallbackChannelTaskSituation(task: Task): SituationId | null {
  const status = task.latest_run?.status;
  if (status === "failed" || status === "cancelled") return null;
  if (
    status === "completed" ||
    typeof task.latest_run?.output?.pr_url === "string"
  ) {
    return "in_review";
  }
  return "working";
}
