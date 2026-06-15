import { reportAgeHours } from "@posthog/core/inbox/engagement";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type { SignalReport } from "@posthog/shared/types";
import { useInboxAllReports } from "@posthog/ui/features/inbox/hooks/useInboxAllReports";
import { track } from "@posthog/ui/shell/analytics";
import { useEffect, useRef } from "react";

/**
 * Last report id opened in this session, used to populate
 * `previous_report_id` on the next `INBOX_REPORT_OPENED`. Module-scoped so it
 * survives the detail screen unmounting between reports.
 */
let lastOpenedReportId: string | null = null;

/**
 * Fires `INBOX_REPORT_OPENED` when a detail screen mounts (or switches to a new
 * report) and `INBOX_REPORT_CLOSED` with the dwell time when it unmounts.
 *
 * Restores the open/close engagement events dropped when Inbox 2.0 deleted
 * `useInboxEngagementTracker`. Driven by the detail route lifecycle via
 * `InboxReportDetailGate`, so it covers reports, pull requests, and runs.
 *
 * `open_method` and `scrolled` are not yet wired in the route-based UI (the v1
 * open-method plumbing and scroll tracker were removed), so they report
 * "unknown" and `false` respectively.
 */
export function useReportOpenTracker(report: SignalReport): void {
  const { scopedReports } = useInboxAllReports();

  // Keep the visible list reachable from the mount effect without making the
  // effect re-run (and thus re-fire OPENED) on every list refetch.
  const scopedReportsRef = useRef(scopedReports);
  scopedReportsRef.current = scopedReports;

  // Snapshot report fields so the unmount cleanup reports the values as they
  // were at open time, not whatever the prop is at teardown.
  const reportRef = useRef(report);
  reportRef.current = report;

  // biome-ignore lint/correctness/useExhaustiveDependencies: report.id is the trigger — the detail route stays mounted across report→report navigation, so we re-bracket OPENED/CLOSED on id change while reading the rest from refs.
  useEffect(() => {
    const openedAt = Date.now();
    const opened = reportRef.current;
    const visible = scopedReportsRef.current;
    const rank = visible.findIndex((r) => r.id === opened.id);

    track(ANALYTICS_EVENTS.INBOX_REPORT_OPENED, {
      report_id: opened.id,
      report_title: opened.title ?? null,
      report_age_hours: reportAgeHours(opened.created_at),
      status: opened.status ?? null,
      priority: opened.priority ?? null,
      actionability: opened.actionability ?? null,
      source_products: opened.source_products ?? [],
      rank,
      list_size: visible.length,
      open_method: "unknown",
      previous_report_id: lastOpenedReportId,
    });
    lastOpenedReportId = opened.id;

    return () => {
      track(ANALYTICS_EVENTS.INBOX_REPORT_CLOSED, {
        report_id: opened.id,
        report_title: opened.title ?? null,
        report_age_hours: reportAgeHours(opened.created_at),
        priority: opened.priority ?? null,
        actionability: opened.actionability ?? null,
        time_spent_ms: Date.now() - openedAt,
        scrolled: false,
        close_method: "navigated_away",
      });
    };
  }, [report.id]);
}
