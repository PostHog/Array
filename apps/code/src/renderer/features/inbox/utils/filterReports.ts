import type {
  SignalReport,
  SignalReportOrderingField,
  SignalReportPriority,
  SignalReportStatus,
} from "@shared/types";

function normalizeReviewerId(value: string): string {
  return value.trim();
}

/**
 * Reports that are surfaced to the current user as needing review: ready,
 * immediately actionable, and addressed to them. Used for both the sidebar
 * red badge count and the inbox toolbar "up for review" byline so the two
 * numbers always agree.
 */
export function isReportUpForReview(report: SignalReport): boolean {
  return (
    report.status === "ready" &&
    report.is_suggested_reviewer === true &&
    report.actionability === "immediately_actionable"
  );
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
 * 1. Status rank (ready first — semantic server-side rank, always applied)
 * 2. Suggested reviewer (current user's reports first)
 * 3. Toolbar-selected field (priority, total_weight, created_at, etc.)
 */
export function buildSignalReportListOrdering(
  field: SignalReportOrderingField,
  direction: "asc" | "desc",
): string {
  const fieldKey = direction === "desc" ? `-${field}` : field;
  return `status,-is_suggested_reviewer,${fieldKey}`;
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
