import {
  buildSignalReportListOrdering,
  INBOX_DISMISSED_STATUS_FILTER,
} from "@posthog/core/inbox/reportFiltering";
import { useInboxReportsInfinite } from "@posthog/ui/features/inbox/hooks/useInboxReports";

/**
 * Dismissed (suppressed) reports for the Dismissed tab. These are excluded from
 * the main pipeline query, so they get a dedicated fetch.
 *
 * No polling interval: the dismissed list changes only when the user dismisses
 * or restores a report, and both paths invalidate `reportKeys.all`, which this
 * query falls under. Newest-dismissed first via `updated_at` (last state change).
 */
export function useInboxDismissedReports() {
  const query = useInboxReportsInfinite({
    status: INBOX_DISMISSED_STATUS_FILTER,
    ordering: buildSignalReportListOrdering("updated_at", "desc"),
  });

  return {
    ...query,
    reports: query.allReports,
  };
}
