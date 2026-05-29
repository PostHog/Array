import {
  reportAgeHours,
  resolveActionProperties,
} from "@posthog/core/inbox/engagement";
import {
  ANALYTICS_EVENTS,
  type InboxReportActionProperties,
  type InboxReportCloseMethod,
} from "@posthog/shared/analytics-events";
import type { SignalReport } from "@posthog/shared/domain-types";
import { useCallback, useEffect, useRef } from "react";
import { track } from "../../../shell/analytics";
import { consumePendingInboxOpenMethod } from "../utils/pendingInboxOpenMethod";

interface OpenInfo {
  reportId: string;
  reportTitle: string | null;
  reportCreatedAt: string | null;
  reportPriority: string | null;
  reportActionability: string | null;
  openedAt: number;
  rank: number;
  listSize: number;
  hasScrolled: boolean;
}

export interface InboxEngagementTracker {
  /** Fires INBOX_REPORT_SCROLLED once per open on the first scroll inside the detail pane. */
  signalScroll(): void;
  /**
   * Fires INBOX_REPORT_ACTION for the current open or an explicit report id.
   *
   * `rank`, `list_size`, `priority`, and `actionability` default to the live tracker
   * state (or a lookup in the visible list for non-current reports). Callers that fire
   * after an async mutation (bulk dismiss/delete/snooze/reingest, single-report dismiss
   * confirm) should snapshot the pre-mutation values and pass them through — by the
   * time the promise resolves the visible list has usually been re-queried without the
   * affected report.
   */
  signalAction(
    action: Omit<
      InboxReportActionProperties,
      "rank" | "list_size" | "priority" | "actionability"
    > & {
      rank?: number;
      list_size?: number;
      priority?: string | null;
      actionability?: string | null;
    },
  ): void;
}

export interface UseInboxEngagementTrackerOptions {
  currentReportId: string | null;
  currentReport: SignalReport | null;
  reports: SignalReport[];
  isInboxView: boolean;
}

export function useInboxEngagementTracker(
  options: UseInboxEngagementTrackerOptions,
): InboxEngagementTracker {
  const { currentReportId, currentReport, reports, isInboxView } = options;

  const openInfoRef = useRef<OpenInfo | null>(null);
  const previousReportIdRef = useRef<string | null>(null);

  // Keep reports/currentReport accessible to callbacks without retriggering effects.
  const reportsRef = useRef(reports);
  reportsRef.current = reports;
  const currentReportRef = useRef(currentReport);
  currentReportRef.current = currentReport;

  const fireClose = useCallback((closeMethod: InboxReportCloseMethod) => {
    const info = openInfoRef.current;
    if (!info) return;
    track(ANALYTICS_EVENTS.INBOX_REPORT_CLOSED, {
      report_id: info.reportId,
      report_title: info.reportTitle,
      report_age_hours: reportAgeHours(info.reportCreatedAt),
      priority: info.reportPriority,
      actionability: info.reportActionability,
      time_spent_ms: Date.now() - info.openedAt,
      scrolled: info.hasScrolled,
      close_method: closeMethod,
    });
    openInfoRef.current = null;
  }, []);

  // Drive OPENED / CLOSED transitions on selection change.
  useEffect(() => {
    const prevInfo = openInfoRef.current;
    const prevId = prevInfo?.reportId ?? null;

    if (currentReportId === prevId) return;

    if (prevInfo) {
      fireClose(currentReportId == null ? "deselected" : "next_report");
    }

    if (currentReportId != null) {
      const visibleReports = reportsRef.current;
      const rank = visibleReports.findIndex((r) => r.id === currentReportId);
      const listSize = visibleReports.length;
      const openMethod = consumePendingInboxOpenMethod();
      const report = currentReportRef.current;

      const info: OpenInfo = {
        reportId: currentReportId,
        reportTitle: report?.title ?? null,
        reportCreatedAt: report?.created_at ?? null,
        reportPriority: report?.priority ?? null,
        reportActionability: report?.actionability ?? null,
        openedAt: Date.now(),
        rank,
        listSize,
        hasScrolled: false,
      };
      openInfoRef.current = info;

      track(ANALYTICS_EVENTS.INBOX_REPORT_OPENED, {
        report_id: currentReportId,
        report_title: info.reportTitle,
        report_age_hours: reportAgeHours(info.reportCreatedAt),
        status: report?.status ?? null,
        priority: info.reportPriority,
        actionability: info.reportActionability,
        source_products: report?.source_products ?? [],
        rank,
        list_size: listSize,
        open_method: openMethod,
        previous_report_id: previousReportIdRef.current,
      });
    }

    previousReportIdRef.current = currentReportId;
  }, [currentReportId, fireClose]);

  // Close on inbox-view exit.
  useEffect(() => {
    if (isInboxView) return;
    if (openInfoRef.current) {
      fireClose("navigated_away");
    }
  }, [isInboxView, fireClose]);

  // Close on unmount (covers app quit / hard navigation).
  useEffect(() => {
    return () => {
      if (openInfoRef.current) {
        fireClose("unmount");
      }
    };
  }, [fireClose]);

  const signalScroll = useCallback(() => {
    const info = openInfoRef.current;
    if (!info || info.hasScrolled) return;
    info.hasScrolled = true;
    track(ANALYTICS_EVENTS.INBOX_REPORT_SCROLLED, {
      report_id: info.reportId,
      report_title: info.reportTitle,
      report_age_hours: reportAgeHours(info.reportCreatedAt),
      priority: info.reportPriority,
      actionability: info.reportActionability,
      rank: info.rank,
      list_size: info.listSize,
      time_since_open_ms: Date.now() - info.openedAt,
    });
  }, []);

  const signalAction = useCallback(
    (
      action: Omit<
        InboxReportActionProperties,
        "rank" | "list_size" | "priority" | "actionability"
      > & {
        rank?: number;
        list_size?: number;
        priority?: string | null;
        actionability?: string | null;
      },
    ) => {
      const info = openInfoRef.current;
      const {
        rank: rankOverride,
        list_size: listSizeOverride,
        priority: priorityOverride,
        actionability: actionabilityOverride,
        ...rest
      } = action;
      const resolved = resolveActionProperties({
        reportId: action.report_id,
        rankOverride,
        listSizeOverride,
        priorityOverride,
        actionabilityOverride,
        openSnapshot: info
          ? {
              reportId: info.reportId,
              rank: info.rank,
              reportPriority: info.reportPriority,
              reportActionability: info.reportActionability,
            }
          : null,
        visibleReports: reportsRef.current,
      });
      track(ANALYTICS_EVENTS.INBOX_REPORT_ACTION, {
        ...rest,
        ...resolved,
      });
    },
    [],
  );

  return { signalScroll, signalAction };
}
