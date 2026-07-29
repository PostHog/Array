import { describe, expect, it } from "vitest";
import {
  INBOX_FEEDBACK_NOTE_MAX_LENGTH,
  INITIAL_INBOX_REPORT_FEEDBACK_STATE,
  type InboxReportFeedbackEvent,
  type InboxReportFeedbackState,
  reduceInboxReportFeedback,
} from "./inbox-report-feedback";

/** Fold a sequence of events, collecting everything the host would have emitted. */
function run(events: InboxReportFeedbackEvent[]): {
  state: InboxReportFeedbackState;
  emissions: unknown[];
} {
  let state = INITIAL_INBOX_REPORT_FEEDBACK_STATE;
  const emissions: unknown[] = [];
  for (const event of events) {
    const transition = reduceInboxReportFeedback(state, event);
    state = transition.state;
    if (transition.emit) emissions.push(transition.emit);
  }
  return { state, emissions };
}

describe("reduceInboxReportFeedback", () => {
  it("emits exactly one sentiment event per selected thumb", () => {
    const { state, emissions } = run([
      { kind: "rate", sentiment: "positive" },
      { kind: "rate", sentiment: "positive" },
      { kind: "rate", sentiment: "positive" },
    ]);

    expect(emissions).toEqual([{ kind: "feedback", sentiment: "positive" }]);
    expect(state.sentiment).toBe("positive");
  });

  it("emits again when the reader switches thumbs", () => {
    const { state, emissions } = run([
      { kind: "rate", sentiment: "positive" },
      { kind: "rate", sentiment: "negative" },
    ]);

    expect(emissions).toEqual([
      { kind: "feedback", sentiment: "positive" },
      { kind: "feedback", sentiment: "negative" },
    ]);
    expect(state.sentiment).toBe("negative");
  });

  it("sends the note as its own event after a rating", () => {
    const { state, emissions } = run([
      { kind: "rate", sentiment: "negative" },
      { kind: "open_note" },
      { kind: "set_note_draft", draft: "  the repro steps were wrong  " },
      { kind: "submit_note" },
    ]);

    expect(emissions).toEqual([
      { kind: "feedback", sentiment: "negative" },
      {
        kind: "feedback_note",
        sentiment: "negative",
        note: "the repro steps were wrong",
      },
    ]);
    expect(state).toEqual({
      sentiment: "negative",
      noteOpen: false,
      noteDraft: "",
      noteSent: true,
    });
  });

  it.each([
    {
      name: "no rating yet",
      events: [
        { kind: "open_note" },
        { kind: "set_note_draft", draft: "unsolicited" },
        { kind: "submit_note" },
      ] as InboxReportFeedbackEvent[],
    },
    {
      name: "blank draft",
      events: [
        { kind: "rate", sentiment: "positive" },
        { kind: "open_note" },
        { kind: "set_note_draft", draft: "   " },
        { kind: "submit_note" },
      ] as InboxReportFeedbackEvent[],
    },
  ])("never sends a note with $name", ({ events }) => {
    const { emissions } = run(events);

    expect(
      emissions.filter((e) => (e as { kind: string }).kind === "feedback_note"),
    ).toEqual([]);
  });

  it("does not open the note field before a rating", () => {
    const { state } = run([{ kind: "open_note" }]);

    expect(state.noteOpen).toBe(false);
  });

  it("drops an unsent draft when the rating changes", () => {
    const { state, emissions } = run([
      { kind: "rate", sentiment: "positive" },
      { kind: "open_note" },
      { kind: "set_note_draft", draft: "actually this was great" },
      { kind: "rate", sentiment: "negative" },
      { kind: "submit_note" },
    ]);

    // The draft praised the report; it must not resurface attached to the thumbs-down.
    expect(emissions).toEqual([
      { kind: "feedback", sentiment: "positive" },
      { kind: "feedback", sentiment: "negative" },
    ]);
    expect(state).toEqual({
      sentiment: "negative",
      noteOpen: false,
      noteDraft: "",
      noteSent: false,
    });
  });

  it("resets the sent marker when the rating changes, so a new note can be added", () => {
    const { state } = run([
      { kind: "rate", sentiment: "positive" },
      { kind: "open_note" },
      { kind: "set_note_draft", draft: "useful" },
      { kind: "submit_note" },
      { kind: "rate", sentiment: "negative" },
    ]);

    expect(state.noteSent).toBe(false);
  });

  it("caps the draft at the note length limit", () => {
    const { state } = run([
      { kind: "rate", sentiment: "positive" },
      { kind: "open_note" },
      {
        kind: "set_note_draft",
        draft: "x".repeat(INBOX_FEEDBACK_NOTE_MAX_LENGTH + 50),
      },
    ]);

    expect(state.noteDraft).toHaveLength(INBOX_FEEDBACK_NOTE_MAX_LENGTH);
  });
});
