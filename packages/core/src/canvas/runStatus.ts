import type { TaskRunStatus } from "@posthog/shared/domain-types";

export type RunStatusVariant =
  | "default"
  | "destructive"
  | "info"
  | "success"
  | "warning";

export const RUN_STATUS_LABELS: Record<TaskRunStatus, string> = {
  not_started: "Not started",
  queued: "Queued",
  in_progress: "In progress",
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
