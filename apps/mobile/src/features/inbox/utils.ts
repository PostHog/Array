import type { InboxViewedProperties } from "@/lib/analytics";
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

interface InboxViewedFilterState {
  sourceProductFilter: string[];
  statusFilter: SignalReportStatus[];
  suggestedReviewerFilter: string[];
  /** Default status filter as defined in the filter store, used to detect whether the user has narrowed it. */
  defaultStatusFilter: SignalReportStatus[];
}

/**
 * Build the property payload for the `Inbox viewed` analytics event.
 *
 * Mirrors apps/code/src/renderer/features/inbox/components/InboxSignalsTab.tsx so
 * desktop and mobile send the same shape into PostHog.
 */
export function buildInboxViewedProperties(
  reports: SignalReport[],
  totalCount: number,
  filters: InboxViewedFilterState,
): InboxViewedProperties {
  const priorityCounts = {
    P0: 0,
    P1: 0,
    P2: 0,
    P3: 0,
    P4: 0,
    unknown: 0,
  };
  const actionabilityCounts = {
    immediately_actionable: 0,
    requires_human_input: 0,
    not_actionable: 0,
    unknown: 0,
  };
  let readyCount = 0;
  for (const r of reports) {
    if (r.status === "ready") readyCount += 1;
    const p = r.priority;
    if (p === "P0" || p === "P1" || p === "P2" || p === "P3" || p === "P4") {
      priorityCounts[p] += 1;
    } else {
      priorityCounts.unknown += 1;
    }
    const a = r.actionability;
    if (
      a === "immediately_actionable" ||
      a === "requires_human_input" ||
      a === "not_actionable"
    ) {
      actionabilityCounts[a] += 1;
    } else {
      actionabilityCounts.unknown += 1;
    }
  }

  const statusFiltered =
    filters.statusFilter.length !== filters.defaultStatusFilter.length ||
    filters.statusFilter.some((s) => !filters.defaultStatusFilter.includes(s));
  const hasActiveFilters =
    statusFiltered ||
    filters.sourceProductFilter.length > 0 ||
    filters.suggestedReviewerFilter.length > 0;

  return {
    report_count: reports.length,
    total_count: totalCount,
    ready_count: readyCount,
    has_active_filters: hasActiveFilters,
    source_product_filter: filters.sourceProductFilter,
    status_filter_count: filters.statusFilter.length,
    is_empty: totalCount === 0,
    is_gated_due_to_scale: false,
    priority_p0_count: priorityCounts.P0,
    priority_p1_count: priorityCounts.P1,
    priority_p2_count: priorityCounts.P2,
    priority_p3_count: priorityCounts.P3,
    priority_p4_count: priorityCounts.P4,
    priority_unknown_count: priorityCounts.unknown,
    actionability_immediately_actionable_count:
      actionabilityCounts.immediately_actionable,
    actionability_requires_human_input_count:
      actionabilityCounts.requires_human_input,
    actionability_not_actionable_count: actionabilityCounts.not_actionable,
    actionability_unknown_count: actionabilityCounts.unknown,
  };
}
