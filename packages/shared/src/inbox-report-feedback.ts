/**
 * Report usefulness feedback: the state machine behind the thumbs row at the end
 * of an inbox report. Rating a report is analytics-only — nothing about the
 * report changes — so the whole feature is this reducer plus two events.
 *
 * It lives in `shared` because desktop, mobile, and the PostHog web frontend all
 * need to behave identically: ranking work joins ratings across clients on
 * `report_id`, so a client that double-fires a sentiment or attaches a note to a
 * rating the reader has since changed poisons the label set. Pure by design —
 * hosts hold the state however suits them and only have to honour `emit`.
 */

/** Sentiment captured by the report usefulness thumbs. */
export type InboxReportFeedbackSentiment = "positive" | "negative";

/**
 * Cap on the optional note. Matches the sibling inbox note fields (dismiss,
 * discuss); the note rides along as an analytics property, so it has to stay
 * under the client's per-property limit.
 */
export const INBOX_FEEDBACK_NOTE_MAX_LENGTH = 4000;

export interface InboxReportFeedbackState {
  /** The thumb this reader chose, or null while the report is unrated. */
  sentiment: InboxReportFeedbackSentiment | null;
  /** Whether the optional note field is showing. */
  noteOpen: boolean;
  noteDraft: string;
  /** True once a note has been sent for the current sentiment. */
  noteSent: boolean;
}

export const INITIAL_INBOX_REPORT_FEEDBACK_STATE: InboxReportFeedbackState = {
  sentiment: null,
  noteOpen: false,
  noteDraft: "",
  noteSent: false,
};

export type InboxReportFeedbackEvent =
  | { kind: "rate"; sentiment: InboxReportFeedbackSentiment }
  | { kind: "open_note" }
  | { kind: "set_note_draft"; draft: string }
  | { kind: "submit_note" };

/** What the host should send to analytics for a transition. */
export type InboxReportFeedbackEmission =
  | { kind: "feedback"; sentiment: InboxReportFeedbackSentiment }
  | {
      kind: "feedback_note";
      sentiment: InboxReportFeedbackSentiment;
      note: string;
    };

export interface InboxReportFeedbackTransition {
  state: InboxReportFeedbackState;
  /** Null when the event changed nothing worth reporting. */
  emit: InboxReportFeedbackEmission | null;
}

export function reduceInboxReportFeedback(
  state: InboxReportFeedbackState,
  event: InboxReportFeedbackEvent,
): InboxReportFeedbackTransition {
  switch (event.kind) {
    case "rate":
      // Re-clicking the chosen thumb is a no-op rather than a second identical
      // event — one sentiment event per selected thumb is the whole contract.
      if (state.sentiment === event.sentiment) {
        return { state, emit: null };
      }
      // Changing the rating drops an unsent draft, so a note can never end up
      // attached to a sentiment the reader has since changed their mind about.
      return {
        state: {
          sentiment: event.sentiment,
          noteOpen: false,
          noteDraft: "",
          noteSent: false,
        },
        emit: { kind: "feedback", sentiment: event.sentiment },
      };
    case "open_note":
      // The note is offered only once a rating is in, so it can never gate the
      // rating: ignoring it leaves the flow exactly as it was.
      if (!state.sentiment || state.noteOpen) {
        return { state, emit: null };
      }
      return { state: { ...state, noteOpen: true }, emit: null };
    case "set_note_draft":
      return {
        state: {
          ...state,
          noteDraft: event.draft.slice(0, INBOX_FEEDBACK_NOTE_MAX_LENGTH),
        },
        emit: null,
      };
    case "submit_note": {
      const note = state.noteDraft.trim();
      if (!state.sentiment || !note) {
        return { state, emit: null };
      }
      return {
        state: { ...state, noteOpen: false, noteDraft: "", noteSent: true },
        emit: { kind: "feedback_note", sentiment: state.sentiment, note },
      };
    }
  }
}
