import type { InboxReportActionSurface } from "@posthog/shared";
import {
  ANALYTICS_EVENTS,
  INITIAL_INBOX_REPORT_FEEDBACK_STATE,
  type InboxReportFeedbackEvent,
  type InboxReportFeedbackSentiment,
  type InboxReportFeedbackState,
  reduceInboxReportFeedback,
} from "@posthog/shared";
import type { SignalReport } from "@posthog/shared/types";
import { reportAgeHours } from "@posthog/ui/features/inbox/utils/reportAgeHours";
import { track } from "@posthog/ui/shell/analytics";
import { useCallback, useState } from "react";

export interface ReportFeedback extends InboxReportFeedbackState {
  /** Rate the report. Re-picking the current thumb is a no-op. */
  rate: (sentiment: InboxReportFeedbackSentiment) => void;
  openNote: () => void;
  setNoteDraft: (draft: string) => void;
  submitNote: () => void;
}

/**
 * Report usefulness feedback for the open report. The state and the
 * one-event-per-thumb rules live in `reduceInboxReportFeedback` (shared with
 * mobile and the PostHog web frontend); this hook holds the state and turns the
 * reducer's emissions into events.
 *
 * Analytics-only — nothing about the report changes, so there is no mutation here.
 */
export function useReportFeedback(
  report: SignalReport,
  surface: InboxReportActionSurface = "detail_footer",
): ReportFeedback {
  // Keyed by report id so navigating between details starts from unrated
  // without an effect, even when React reuses the component instance.
  const [entry, setEntry] = useState({
    reportId: report.id,
    state: INITIAL_INBOX_REPORT_FEEDBACK_STATE,
  });
  const state =
    entry.reportId === report.id
      ? entry.state
      : INITIAL_INBOX_REPORT_FEEDBACK_STATE;

  const dispatch = useCallback(
    (event: InboxReportFeedbackEvent) => {
      // Reduce outside the state updater: Strict Mode double-invokes updaters
      // in development, which would double-fire the event.
      const { state: next, emit } = reduceInboxReportFeedback(state, event);
      setEntry({ reportId: report.id, state: next });
      if (!emit) return;
      const base = {
        report_id: report.id,
        report_title: report.title ?? null,
        report_age_hours: reportAgeHours(report),
        priority: report.priority ?? null,
        actionability: report.actionability ?? null,
        sentiment: emit.sentiment,
        has_pr: !!report.implementation_pr_url,
        surface,
      };
      if (emit.kind === "feedback") {
        track(ANALYTICS_EVENTS.INBOX_REPORT_FEEDBACK, base);
      } else {
        track(ANALYTICS_EVENTS.INBOX_REPORT_FEEDBACK_NOTE, {
          ...base,
          note: emit.note,
        });
      }
    },
    [report, state, surface],
  );

  return {
    ...state,
    rate: useCallback(
      (sentiment: InboxReportFeedbackSentiment) =>
        dispatch({ kind: "rate", sentiment }),
      [dispatch],
    ),
    openNote: useCallback(() => dispatch({ kind: "open_note" }), [dispatch]),
    setNoteDraft: useCallback(
      (draft: string) => dispatch({ kind: "set_note_draft", draft }),
      [dispatch],
    ),
    submitNote: useCallback(
      () => dispatch({ kind: "submit_note" }),
      [dispatch],
    ),
  };
}
