import type { LoopRunStatus } from "../types";

export interface LoopStatusPresentation {
  label: string;
  className: string;
}

const RUNNING_STATUSES = new Set(["not_started", "queued", "in_progress"]);
const SUCCESS_STATUSES = new Set(["completed", "success"]);
const FAILED_STATUSES = new Set(["failed", "cancelled"]);

/** Presentation for `Loop.last_run_status`, a loose bookkeeping string (not
 *  the `LoopRunStatus` enum) that mirrors the values a `LoopRun` can settle
 *  into. Returns `null` while a run is active so the caller can fall back to
 *  its own in-progress indicator instead of a static badge. */
export function getLoopLastRunPresentation(
  lastRunStatus: string | null,
): LoopStatusPresentation | null {
  if (!lastRunStatus || RUNNING_STATUSES.has(lastRunStatus)) {
    return null;
  }

  if (SUCCESS_STATUSES.has(lastRunStatus)) {
    return {
      label: "Success",
      className: "bg-status-success/20 text-status-success",
    };
  }

  if (FAILED_STATUSES.has(lastRunStatus)) {
    return {
      label: "Failed",
      className: "bg-status-error/20 text-status-error",
    };
  }

  return { label: "Never run", className: "bg-gray-4 text-gray-11" };
}

export function getLoopRunStatusPresentation(
  status: LoopRunStatus,
): LoopStatusPresentation {
  switch (status) {
    case "not_started":
    case "queued":
      return {
        label: "Queued",
        className: "bg-status-warning/20 text-status-warning",
      };
    case "in_progress":
      return {
        label: "Running",
        className: "bg-status-info/20 text-status-info",
      };
    case "completed":
      return {
        label: "Success",
        className: "bg-status-success/20 text-status-success",
      };
    case "failed":
      return {
        label: "Failed",
        className: "bg-status-error/20 text-status-error",
      };
    case "cancelled":
      return { label: "Cancelled", className: "bg-gray-4 text-gray-11" };
    default:
      return { label: status, className: "bg-gray-4 text-gray-11" };
  }
}
