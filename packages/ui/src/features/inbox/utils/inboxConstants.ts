/** Comma-separated statuses for progressive inbox (excludes terminal failed unless we add later). */
export const INBOX_PIPELINE_STATUS_FILTER =
  "potential,candidate,in_progress,ready,pending_input";

/** Polling interval for inbox queries while the Electron window is focused. */
export const INBOX_REFETCH_INTERVAL_MS = 3000;
