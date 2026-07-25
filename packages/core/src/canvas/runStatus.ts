import type { TaskRunStatus } from "@posthog/shared/domain-types";

/** Badge tone for a run status. Mirrors quill's `Badge` variants. */
export type RunStatusVariant =
  | "default"
  | "destructive"
  | "info"
  | "success"
  | "warning";

/**
 * The one place a run status becomes words. Keyed on `TaskRunStatus` so adding
 * a status is a compile error here rather than an unlabelled badge downstream.
 */
export const RUN_STATUS_LABELS: Record<TaskRunStatus, string> = {
  not_started: "Not started",
  queued: "Queued",
  in_progress: "In progress",
  // "Ready", not "Completed": the agent has finished its work and the task is
  // ready to look at, but the change itself isn't necessarily shipped/done.
  completed: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

const RUN_STATUS_VARIANTS: Record<TaskRunStatus, RunStatusVariant> = {
  not_started: "default",
  queued: "default",
  in_progress: "info",
  completed: "success",
  failed: "destructive",
  cancelled: "default",
};

export function runStatusLabel(
  status: TaskRunStatus | null | undefined,
): string | null {
  return status ? RUN_STATUS_LABELS[status] : null;
}

export function runStatusVariant(
  status: TaskRunStatus | null | undefined,
): RunStatusVariant {
  return status ? RUN_STATUS_VARIANTS[status] : "default";
}

/**
 * Statuses worth filtering a channel's items by, in the order they're offered.
 * Derived from the label map so a new status can't be silently unfilterable.
 */
export const RUN_STATUS_FILTER_OPTIONS: readonly {
  value: TaskRunStatus | null;
  label: string;
}[] = [
  { value: null, label: "Any status" },
  ...(
    [
      "not_started",
      "queued",
      "in_progress",
      "completed",
      "failed",
      "cancelled",
    ] as const
  ).map((value) => ({ value, label: RUN_STATUS_LABELS[value] })),
];
