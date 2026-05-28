import { useCallback, useEffect, useRef } from "react";
import {
  ANALYTICS_EVENTS,
  type Analytics,
  computeReportAgeHours,
  type InboxReportActionProperties,
  type InboxReportCloseMethod,
  type InboxReportOpenMethod,
} from "@/lib/analytics";
import type { SignalReport } from "../types";

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
  signalScroll(): void;
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
  analytics: Analytics;
  report: SignalReport | null;
  /** Rank of the report in the visible inbox list, or -1 if not in a list view. */
  rank: number;
  /** Size of the visible inbox list, or 0 if not in a list view. */
  listSize: number;
  /** Method that brought the user to this report. */
  openMethod: InboxReportOpenMethod;
  /** Previously-opened report id; null on the first open of a session. */
  previousReportId: string | null;
}

export function useInboxEngagementTracker(
  options: UseInboxEngagementTrackerOptions,
): InboxEngagementTracker {
  const { analytics, report, rank, listSize, openMethod, previousReportId } =
    options;

  const openInfoRef = useRef<OpenInfo | null>(null);

  const analyticsRef = useRef(analytics);
  analyticsRef.current = analytics;

  const fireClose = useCallback((closeMethod: InboxReportCloseMethod) => {
    const info = openInfoRef.current;
    if (!info) return;
    analyticsRef.current.track(ANALYTICS_EVENTS.INBOX_REPORT_CLOSED, {
      report_id: info.reportId,
      report_title: info.reportTitle,
      report_age_hours: computeReportAgeHours(info.reportCreatedAt),
      priority: info.reportPriority,
      actionability: info.reportActionability,
      time_spent_ms: Date.now() - info.openedAt,
      scrolled: info.hasScrolled,
      close_method: closeMethod,
    });
    openInfoRef.current = null;
  }, []);

  const reportId = report?.id ?? null;

  useEffect(() => {
    if (!reportId || !report) return;

    const info: OpenInfo = {
      reportId,
      reportTitle: report.title ?? null,
      reportCreatedAt: report.created_at ?? null,
      reportPriority: report.priority ?? null,
      reportActionability: report.actionability ?? null,
      openedAt: Date.now(),
      rank,
      listSize,
      hasScrolled: false,
    };
    openInfoRef.current = info;

    analyticsRef.current.track(ANALYTICS_EVENTS.INBOX_REPORT_OPENED, {
      report_id: info.reportId,
      report_title: info.reportTitle,
      report_age_hours: computeReportAgeHours(info.reportCreatedAt),
      status: report.status ?? null,
      priority: info.reportPriority,
      actionability: info.reportActionability,
      source_products: report.source_products ?? [],
      rank: info.rank,
      list_size: info.listSize,
      open_method: openMethod,
      previous_report_id: previousReportId,
    });

    return () => {
      fireClose("deselected");
    };
  }, [
    reportId,
    report,
    rank,
    listSize,
    openMethod,
    previousReportId,
    fireClose,
  ]);

  const signalScroll = useCallback(() => {
    const info = openInfoRef.current;
    if (!info || info.hasScrolled) return;
    info.hasScrolled = true;
    analyticsRef.current.track(ANALYTICS_EVENTS.INBOX_REPORT_SCROLLED, {
      report_id: info.reportId,
      report_title: info.reportTitle,
      report_age_hours: computeReportAgeHours(info.reportCreatedAt),
      priority: info.reportPriority,
      actionability: info.reportActionability,
      rank: info.rank,
      list_size: info.listSize,
      time_since_open_ms: Date.now() - info.openedAt,
    });
  }, []);

  const signalAction = useCallback<InboxEngagementTracker["signalAction"]>(
    (action) => {
      const info = openInfoRef.current;
      const currentInfo =
        info && info.reportId === action.report_id ? info : null;
      const {
        rank: rankOverride,
        list_size: listSizeOverride,
        priority: priorityOverride,
        actionability: actionabilityOverride,
        ...rest
      } = action;
      analyticsRef.current.track(ANALYTICS_EVENTS.INBOX_REPORT_ACTION, {
        ...rest,
        rank:
          rankOverride !== undefined ? rankOverride : (currentInfo?.rank ?? -1),
        list_size:
          listSizeOverride !== undefined
            ? listSizeOverride
            : (currentInfo?.listSize ?? 0),
        priority:
          priorityOverride !== undefined
            ? priorityOverride
            : (currentInfo?.reportPriority ?? null),
        actionability:
          actionabilityOverride !== undefined
            ? actionabilityOverride
            : (currentInfo?.reportActionability ?? null),
      });
    },
    [],
  );

  return { signalScroll, signalAction };
}
