import type { TaskActivity, UserBasic } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import {
  countUnseenActivity,
  mergeTaskActivity,
  toTaskActivityItems,
} from "./taskActivity";

const ann: UserBasic = {
  id: 2,
  uuid: "ann-uuid",
  email: "ann@posthog.com",
  first_name: "Ann",
};

function activity(overrides: Partial<TaskActivity> = {}): TaskActivity {
  return {
    task_id: "t1",
    task_title: "Task t1",
    channel_id: "c1",
    channel_name: "general",
    activity_at: "2026-07-01T10:00:00Z",
    activity_kind: "mention",
    snippet: "ping @[Me](me@posthog.com)",
    latest_author: ann,
    latest_message_id: "m1",
    ...overrides,
  };
}

describe("toTaskActivityItems", () => {
  it("maps activity DTOs to feed items", () => {
    expect(toTaskActivityItems([activity()])).toEqual([
      {
        taskId: "t1",
        taskTitle: "Task t1",
        channelId: "c1",
        channelName: "general",
        activityAt: "2026-07-01T10:00:00Z",
        activityKind: "mention",
        snippet: "ping @[Me](me@posthog.com)",
        author: ann,
        messageId: "m1",
      },
    ]);
  });

  it("labels untitled tasks and tolerates missing channel/author/message", () => {
    const items = toTaskActivityItems([
      activity({
        task_title: "",
        channel_id: null,
        channel_name: null,
        latest_author: null,
        latest_message_id: null,
        activity_kind: "created",
        snippet: "",
      }),
    ]);
    expect(items[0]).toMatchObject({
      taskTitle: "Untitled task",
      channelId: null,
      channelName: null,
      author: null,
      messageId: null,
    });
  });
});

describe("countUnseenActivity", () => {
  const items = toTaskActivityItems([
    activity({ task_id: "t2", activity_at: "2026-07-03T10:00:00Z" }),
    activity({ task_id: "t1", activity_at: "2026-07-01T10:00:00Z" }),
  ]);

  it("counts everything when never seen", () => {
    expect(countUnseenActivity(items, null)).toBe(2);
  });

  it("counts only rows with activity after the last-seen timestamp", () => {
    expect(countUnseenActivity(items, "2026-07-02T00:00:00Z")).toBe(1);
    expect(countUnseenActivity(items, "2026-07-04T00:00:00Z")).toBe(0);
  });
});

describe("mergeTaskActivity", () => {
  it("prepends newly-active tasks ahead of the previous page", () => {
    const previous = [
      activity({ task_id: "t1", activity_at: "2026-07-01T10:00:00Z" }),
    ];
    const incoming = [
      activity({ task_id: "t2", activity_at: "2026-07-02T10:00:00Z" }),
    ];
    expect(mergeTaskActivity(previous, incoming).map((r) => r.task_id)).toEqual(
      ["t2", "t1"],
    );
  });

  it("replaces a task's row when its activity advances instead of duplicating it", () => {
    const previous = [
      activity({
        task_id: "t1",
        activity_kind: "mention",
        activity_at: "2026-07-01T10:00:00Z",
      }),
    ];
    const incoming = [
      activity({
        task_id: "t1",
        activity_kind: "message",
        snippet: "replied",
        activity_at: "2026-07-02T10:00:00Z",
      }),
    ];
    const merged = mergeTaskActivity(previous, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].activity_kind).toBe("message");
    expect(merged[0].activity_at).toBe("2026-07-02T10:00:00Z");
  });

  it("keeps the newer row when an older duplicate arrives out of order", () => {
    const previous = [
      activity({ task_id: "t1", activity_at: "2026-07-05T10:00:00Z" }),
    ];
    const incoming = [
      activity({ task_id: "t1", activity_at: "2026-07-01T10:00:00Z" }),
    ];
    expect(mergeTaskActivity(previous, incoming)[0].activity_at).toBe(
      "2026-07-05T10:00:00Z",
    );
  });

  it("returns the previous page unchanged when there is nothing new", () => {
    const previous = [activity({ task_id: "t1" })];
    expect(mergeTaskActivity(previous, [])).toEqual(previous);
  });

  it("caps the merged result so a long session can't grow it unbounded", () => {
    const previous = Array.from({ length: 300 }, (_, i) =>
      activity({
        task_id: `old-${i}`,
        activity_at: `2026-06-01T${String(i % 24).padStart(2, "0")}:00:00Z`,
      }),
    );
    const incoming = [
      activity({ task_id: "newest", activity_at: "2026-07-05T10:00:00Z" }),
    ];
    const merged = mergeTaskActivity(previous, incoming);
    expect(merged).toHaveLength(300);
    expect(merged[0].task_id).toBe("newest");
  });
});
