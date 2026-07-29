import {
  EXTERNAL_INBOX_SOURCE_BY_PRODUCT,
  type SourceProduct,
} from "@posthog/shared";
import type {
  Signal,
  SignalReport,
  SignalReportPriority,
  SignalReportStatus,
} from "@posthog/shared/domain-types";
import { differenceInHours, format, formatDistanceToNow } from "date-fns";
import type { InboxViewedProperties } from "@/lib/analytics";

const ERROR_TRACKING_TYPE_LABELS: Record<string, string> = {
  issue_created: "New issue",
  issue_reopened: "Issue reopened",
  issue_spiking: "Volume spike",
};

export function sourceLine(signal: Signal): string {
  const { source_product, source_type } = signal;
  if (source_product === "error_tracking") {
    const label =
      ERROR_TRACKING_TYPE_LABELS[source_type] ?? source_type.replace(/_/g, " ");
    return `Error tracking · ${label}`;
  }
  if (source_product === "session_replay" && source_type === "session_problem")
    return "Session replay · Session problem";
  if (source_product === "llm_analytics" && source_type === "evaluation")
    return "AI observability · Evaluation";
  if (source_product === "zendesk" && source_type === "ticket")
    return "Zendesk · Ticket";
  if (source_product === "github" && source_type === "issue")
    return "GitHub · Issue";
  if (source_product === "linear" && source_type === "issue")
    return "Linear · Issue";
  if (
    source_product === "signals_scout" &&
    source_type === "cross_source_issue"
  )
    return "Scout · Cross-source issue";
  if (source_product === "signals_scout") return "Scout";
  if (source_product === "health_checks" && source_type === "health_issue")
    return "Health checks · Issue";
  const warehouseSource =
    EXTERNAL_INBOX_SOURCE_BY_PRODUCT[source_product as SourceProduct];
  const product = warehouseSource?.label ?? source_product.replace(/_/g, " ");
  return `${product} · ${source_type.replace(/_/g, " ")}`;
}

/** Relative time for the last day, absolute "MMM d" beyond it. */
export function formatReportTimestamp(date: Date): string {
  return differenceInHours(new Date(), date) < 24
    ? formatDistanceToNow(date, { addSuffix: true })
    : format(date, "MMM d");
}

/**
 * Archive membership: `suppressed` (user-archived) and `resolved` (PR merged).
 * Only `suppressed` is restorable; `resolved` is terminal, shown for reference.
 */
export function isRestorableReport(
  report: Pick<SignalReport, "status">,
): boolean {
  return report.status === "suppressed";
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
  statusFilter: readonly SignalReportStatus[];
  suggestedReviewerFilter: string[];
  priorityFilter: SignalReportPriority[];
  /** Default status filter as defined in the filter store, used to detect whether the user has narrowed it. */
  defaultStatusFilter: readonly SignalReportStatus[];
}

/**
 * Build the property payload for the `Inbox viewed` analytics event.
 *
 * Mirrors packages/ui/src/features/inbox/components/InboxSignalsTab.tsx so
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
    filters.suggestedReviewerFilter.length > 0 ||
    filters.priorityFilter.length > 0;

  return {
    report_count: reports.length,
    total_count: totalCount,
    ready_count: readyCount,
    has_active_filters: hasActiveFilters,
    source_product_filter: filters.sourceProductFilter,
    status_filter_count: filters.statusFilter.length,
    is_empty: totalCount === 0,
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
