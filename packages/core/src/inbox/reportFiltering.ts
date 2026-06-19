import type {
  SignalReport,
  SignalReportOrderingField,
  SignalReportPriority,
  SignalReportStatus,
} from "@posthog/shared/types";

/**
 * Comma-separated statuses for the inbox query. We pull `failed` so the Runs
 * tab can surface failed runs in its Recently finished section.
 */
export const INBOX_PIPELINE_STATUS_FILTER =
  "potential,candidate,in_progress,ready,pending_input,failed";

/**
 * Status filter for the Archive tab. `suppressed` is the only archived status:
 * it is the single state the archive action sets, and the only not-in-inbox
 * state worth restoring. `deleted` is permanent and stripped server-side; snooze
 * is a temporary `snoozed_until` timestamp, not a status, and auto-returns. See
 * `isDismissedReport` for the full rationale. Suppressed reports are excluded
 * from the main pipeline query, so the Archive tab fetches them explicitly.
 */
export const INBOX_DISMISSED_STATUS_FILTER = "suppressed";

/**
 * Status filter for the Pull requests tab's list and count. Only `ready` PRs —
 * a Responder draft awaiting review — are surfaced; PRs that have already been
 * merged/closed (`resolved`) or are still running drop off so the tab and its
 * count reflect only actionable work the user can act on. Keeps the count
 * honest about what the list actually shows.
 */
export const INBOX_PULL_REQUEST_STATUS_FILTER = "ready";

/** Polling interval for inbox queries while the Electron window is focused. */
export const INBOX_REFETCH_INTERVAL_MS = 3000;

function normalizeReviewerId(value: string): string {
  return value.trim();
}

export function filterReportsBySearch(
  reports: SignalReport[],
  query: string,
): SignalReport[] {
  const trimmed = query.trim();
  if (!trimmed) return reports;

  const lower = trimmed.toLowerCase();
  return reports.filter(
    (report) =>
      report.title?.toLowerCase().includes(lower) ||
      report.summary?.toLowerCase().includes(lower) ||
      report.id.toLowerCase().includes(lower),
  );
}

/**
 * Build a comma-separated status filter string for the API from an array of statuses.
 */
export function buildStatusFilterParam(statuses: SignalReportStatus[]): string {
  return statuses.join(",");
}

/**
 * Comma-separated `ordering` for the signal report list API:
 * 1. Status rank (ready first – semantic server-side rank, always applied)
 * 2. Toolbar-selected field (priority, total_weight, created_at, etc.)
 *
 * Reviewer scope is applied via the `suggested_reviewers` param, not ordering:
 * a `-is_suggested_reviewer` tiebreak would float the user's reports to the top
 * of the first (and only loaded) page, starving the "Entire project" scope.
 */
export function buildSignalReportListOrdering(
  field: SignalReportOrderingField,
  direction: "asc" | "desc",
): string {
  const fieldKey = direction === "desc" ? `-${field}` : field;
  return `status,${fieldKey}`;
}

export function buildSuggestedReviewerFilterParam(
  reviewerIds: string[],
): string | undefined {
  const normalizedIds = reviewerIds.map(normalizeReviewerId).filter(Boolean);

  if (normalizedIds.length === 0) {
    return undefined;
  }

  return Array.from(new Set(normalizedIds)).join(",");
}

export function buildPriorityFilterParam(
  priorities: SignalReportPriority[],
): string | undefined {
  if (priorities.length === 0) {
    return undefined;
  }
  return Array.from(new Set(priorities)).join(",");
}
