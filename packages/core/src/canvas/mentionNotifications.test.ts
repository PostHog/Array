import type { TaskMention } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import {
  advanceMentionWatch,
  baselineMentionWatch,
  INITIAL_MENTION_WATCH_STATE,
} from "./mentionNotifications";

function mention(overrides: Partial<TaskMention>): TaskMention {
  return {
    id: "mention-1",
    message_id: "message-1",
    task_id: "task-1",
    task_title: "Fix flaky tests",
    content: "@[Adam](adam@posthog.com) can you look?",
    created_at: "2026-07-30T10:00:00Z",
    ...overrides,
  };
}

describe("baselineMentionWatch", () => {
  it("absorbs the backlog without notifying and remembers the newest timestamp", () => {
    const state = baselineMentionWatch(
      [
        mention({ message_id: "m2", created_at: "2026-07-30T10:05:00Z" }),
        mention({ message_id: "m1", created_at: "2026-07-30T10:00:00Z" }),
      ],
      "2026-07-30T11:00:00Z",
    );
    expect(state.seenThrough).toBe("2026-07-30T10:05:00Z");
    expect(state.notifiedMessageIds).toEqual(["m2", "m1"]);
  });

  it("baselines an empty backlog to now so the first real mention still notifies", () => {
    const state = baselineMentionWatch([], "2026-07-30T11:00:00Z");
    expect(state.seenThrough).toBe("2026-07-30T11:00:00Z");

    const { toNotify } = advanceMentionWatch(state, [
      mention({ message_id: "m1", created_at: "2026-07-30T11:01:00Z" }),
    ]);
    expect(toNotify.map((m) => m.message_id)).toEqual(["m1"]);
  });
});

describe("advanceMentionWatch", () => {
  it("returns nothing and keeps state identity when the poll is empty", () => {
    const state = baselineMentionWatch([], "2026-07-30T11:00:00Z");
    const result = advanceMentionWatch(state, []);
    expect(result.toNotify).toEqual([]);
    expect(result.state).toBe(state);
  });

  it("notifies new mentions oldest first and advances the watermark", () => {
    const state = baselineMentionWatch([], "2026-07-30T11:00:00Z");
    const { state: next, toNotify } = advanceMentionWatch(state, [
      mention({ message_id: "m2", created_at: "2026-07-30T11:05:00Z" }),
      mention({ message_id: "m1", created_at: "2026-07-30T11:01:00Z" }),
    ]);
    expect(toNotify.map((m) => m.message_id)).toEqual(["m1", "m2"]);
    expect(next.seenThrough).toBe("2026-07-30T11:05:00Z");
  });

  it("dedupes messages already notified", () => {
    const first = advanceMentionWatch(
      baselineMentionWatch([], "2026-07-30T11:00:00Z"),
      [mention({ message_id: "m1", created_at: "2026-07-30T11:01:00Z" })],
    );
    const second = advanceMentionWatch(first.state, [
      mention({ message_id: "m1", created_at: "2026-07-30T11:01:00Z" }),
      mention({ message_id: "m2", created_at: "2026-07-30T11:02:00Z" }),
    ]);
    expect(second.toNotify.map((m) => m.message_id)).toEqual(["m2"]);
  });

  it("never moves the watermark backwards", () => {
    const state = {
      seenThrough: "2026-07-30T12:00:00Z",
      notifiedMessageIds: [],
    };
    const { state: next } = advanceMentionWatch(state, [
      mention({ message_id: "m1", created_at: "2026-07-30T11:59:00Z" }),
    ]);
    expect(next.seenThrough).toBe("2026-07-30T12:00:00Z");
  });

  it("caps the dedupe set at 500 ids, keeping the newest", () => {
    const backlog = Array.from({ length: 499 }, (_, i) =>
      mention({ message_id: `old-${i}`, created_at: "2026-07-30T10:00:00Z" }),
    );
    const state = baselineMentionWatch(backlog, "2026-07-30T11:00:00Z");
    const { state: next } = advanceMentionWatch(state, [
      mention({ message_id: "new-1", created_at: "2026-07-30T11:01:00Z" }),
      mention({ message_id: "new-2", created_at: "2026-07-30T11:02:00Z" }),
    ]);
    expect(next.notifiedMessageIds).toHaveLength(500);
    expect(next.notifiedMessageIds.slice(0, 2)).toEqual(["new-2", "new-1"]);
    expect(next.notifiedMessageIds).not.toContain("old-498");
  });

  it("keeps INITIAL state inert", () => {
    expect(INITIAL_MENTION_WATCH_STATE.seenThrough).toBeNull();
  });
});
