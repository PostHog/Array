import { consumePendingInboxOpenMethod } from "@features/inbox/utils/pendingInboxOpenMethod";
import type { SignalReport } from "@shared/types";
import {
  ANALYTICS_EVENTS,
  type InboxReportActionProperties,
  type InboxReportCloseMethod,
  type InboxReportEngagementReason,
} from "@shared/types/analytics";
import { track } from "@utils/analytics";
import { useCallback, useEffect, useRef } from "react";

const DWELL_THRESHOLD_MS = 5_000;

interface OpenInfo {
  reportId: string;
  openedAt: number;
  rank: number;
  listSize: number;
  hasScrolled: boolean;
  hasEngaged: boolean;
}

export interface InboxEngagementTracker {
  /** Signal a scroll inside the detail pane — contributes to the dwell+scroll engagement criterion. */
  signalScroll(): void;
  /** Fire INBOX_REPORT_ACTION. If the action targets the currently-open report, also marks it engaged. */
  signalAction(
    action: Omit<InboxReportActionProperties, "rank" | "list_size">,
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
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep reports/currentReport accessible to callbacks without retriggering effects.
  const reportsRef = useRef(reports);
  reportsRef.current = reports;
  const currentReportRef = useRef(currentReport);
  currentReportRef.current = currentReport;

  const fireEngaged = useCallback(
    (info: OpenInfo, reason: InboxReportEngagementReason) => {
      if (info.hasEngaged) return;
      info.hasEngaged = true;
      track(ANALYTICS_EVENTS.INBOX_REPORT_ENGAGED, {
        report_id: info.reportId,
        engagement_reason: reason,
        time_spent_ms_at_engagement: Date.now() - info.openedAt,
        rank: info.rank,
        list_size: info.listSize,
      });
    },
    [],
  );

  const fireClose = useCallback((closeMethod: InboxReportCloseMethod) => {
    const info = openInfoRef.current;
    if (!info) return;
    track(ANALYTICS_EVENTS.INBOX_REPORT_CLOSED, {
      report_id: info.reportId,
      time_spent_ms: Date.now() - info.openedAt,
      scrolled: info.hasScrolled,
      engaged: info.hasEngaged,
      close_method: closeMethod,
    });
    openInfoRef.current = null;
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
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
        openedAt: Date.now(),
        rank,
        listSize,
        hasScrolled: false,
        hasEngaged: false,
      };
      openInfoRef.current = info;

      track(ANALYTICS_EVENTS.INBOX_REPORT_OPENED, {
        report_id: currentReportId,
        status: report?.status ?? null,
        priority: report?.priority ?? null,
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

    const elapsed = Date.now() - info.openedAt;
    if (elapsed >= DWELL_THRESHOLD_MS) {
      fireEngaged(info, "dwell_and_scroll");
      return;
    }
    // Schedule the engaged event to fire once the dwell threshold is crossed.
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    dwellTimerRef.current = setTimeout(() => {
      const currentInfo = openInfoRef.current;
      if (!currentInfo || currentInfo.reportId !== info.reportId) return;
      if (!currentInfo.hasScrolled) return;
      fireEngaged(currentInfo, "dwell_and_scroll");
    }, DWELL_THRESHOLD_MS - elapsed);
  }, [fireEngaged]);

  const signalAction = useCallback(
    (action: Omit<InboxReportActionProperties, "rank" | "list_size">) => {
      const info = openInfoRef.current;
      const visibleReports = reportsRef.current;
      const rank =
        info && info.reportId === action.report_id
          ? info.rank
          : visibleReports.findIndex((r) => r.id === action.report_id);
      track(ANALYTICS_EVENTS.INBOX_REPORT_ACTION, {
        ...action,
        rank,
        list_size: visibleReports.length,
      });
      if (info && info.reportId === action.report_id) {
        fireEngaged(info, "action");
      }
    },
    [fireEngaged],
  );

  return { signalScroll, signalAction };
}
