import type {
  SignalReport,
  SignalReportOrderingField,
  SignalReportStatus,
} from "./types";

export function inboxStatusLabel(status: SignalReportStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "pending_input":
      return "Needs input";
    case "in_progress":
      return "Researching";
    case "candidate":
      return "Queued";
    case "potential":
      return "Gathering";
    case "failed":
      return "Failed";
    case "suppressed":
      return "Suppressed";
    case "deleted":
      return "Deleted";
    default:
      return status;
  }
}

/**
 * Build comma-separated `ordering` param for the API:
 * 1. Status rank (ready first)
 * 2. Suggested reviewer (current user first)
 * 3. User-selected field
 */
export function buildSignalReportListOrdering(
  field: SignalReportOrderingField,
  direction: "asc" | "desc",
): string {
  const fieldKey = direction === "desc" ? `-${field}` : field;
  return `status,-is_suggested_reviewer,${fieldKey}`;
}

/**
 * Build a comma-separated status filter string for the API.
 */
export function buildStatusFilterParam(statuses: SignalReportStatus[]): string {
  return statuses.join(",");
}

/**
 * Build a comma-separated suggested reviewer filter for the API.
 */
export function buildSuggestedReviewerFilterParam(
  reviewerIds: string[],
): string | undefined {
  const normalized = reviewerIds.map((id) => id.trim()).filter(Boolean);
  if (normalized.length === 0) return undefined;
  return Array.from(new Set(normalized)).join(",");
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
 * Returns only reports that are actionable for the tinder-like card deck:
 * ready, immediately actionable, not already addressed.
 */
export function getActionableReports(reports: SignalReport[]): SignalReport[] {
  return reports.filter(
    (r) =>
      r.status === "ready" &&
      r.actionability === "immediately_actionable" &&
      !r.already_addressed,
  );
}
