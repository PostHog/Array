import { formatMention } from "@posthog/shared";
import type {
  Task,
  TaskThreadMessage,
  UserBasic,
} from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import {
  buildMentionActivity,
  countUnseenActivity,
  type MentionActivityTaskRef,
} from "./mentionActivity";

const me: UserBasic = {
  id: 1,
  uuid: "me-uuid",
  email: "me@posthog.com",
};
const ann: UserBasic = {
  id: 2,
  uuid: "ann-uuid",
  email: "ann@posthog.com",
  first_name: "Ann",
};

function task(id: string, title = `Task ${id}`): Task {
  return { id, title } as Task;
}

function message(
  id: string,
  author: UserBasic | null,
  content: string,
  createdAt: string,
): TaskThreadMessage {
  return {
    id,
    task: "t1",
    content,
    created_at: createdAt,
    author,
  };
}

const meToken = formatMention("Me", me.email);

function refs(...tasks: Task[]): MentionActivityTaskRef[] {
  return tasks.map((t) => ({
    task: t,
    channelName: "general",
    folderChannelId: "folder-1",
  }));
}

describe("buildMentionActivity", () => {
  it("returns messages from others that mention me, newest first", () => {
    const threads = new Map([
      [
        "t1",
        [
          message("m1", ann, `ping ${meToken}`, "2026-07-01T10:00:00Z"),
          message("m2", ann, "no mention", "2026-07-01T11:00:00Z"),
        ],
      ],
      ["t2", [message("m3", ann, `also ${meToken}`, "2026-07-02T09:00:00Z")]],
    ]);
    const items = buildMentionActivity(
      me.email,
      refs(task("t1"), task("t2")),
      threads,
    );
    expect(items.map((i) => i.messageId)).toEqual(["m3", "m1"]);
    expect(items[1]).toMatchObject({
      taskId: "t1",
      taskTitle: "Task t1",
      channelName: "general",
      folderChannelId: "folder-1",
      author: ann,
    });
  });

  it("matches the mention email case-insensitively", () => {
    const threads = new Map([
      [
        "t1",
        [
          message(
            "m1",
            ann,
            "hi @[Me](ME@PostHog.com)",
            "2026-07-01T10:00:00Z",
          ),
        ],
      ],
    ]);
    expect(
      buildMentionActivity(me.email, refs(task("t1")), threads),
    ).toHaveLength(1);
  });

  it("skips my own messages even when they mention me", () => {
    const threads = new Map([
      [
        "t1",
        [message("m1", me, `note to self ${meToken}`, "2026-07-01T10:00:00Z")],
      ],
    ]);
    expect(buildMentionActivity(me.email, refs(task("t1")), threads)).toEqual(
      [],
    );
  });

  it("includes authorless messages that mention me", () => {
    const threads = new Map([
      ["t1", [message("m1", null, meToken, "2026-07-01T10:00:00Z")]],
    ]);
    expect(
      buildMentionActivity(me.email, refs(task("t1")), threads),
    ).toHaveLength(1);
  });

  it("returns nothing without a current user email", () => {
    const threads = new Map([
      ["t1", [message("m1", ann, meToken, "2026-07-01T10:00:00Z")]],
    ]);
    expect(buildMentionActivity(null, refs(task("t1")), threads)).toEqual([]);
  });

  it("labels untitled tasks", () => {
    const threads = new Map([
      ["t1", [message("m1", ann, meToken, "2026-07-01T10:00:00Z")]],
    ]);
    const items = buildMentionActivity(me.email, refs(task("t1", "")), threads);
    expect(items[0]?.taskTitle).toBe("Untitled task");
  });
});

describe("countUnseenActivity", () => {
  const threads = new Map([
    [
      "t1",
      [
        message("m1", ann, meToken, "2026-07-01T10:00:00Z"),
        message("m2", ann, meToken, "2026-07-03T10:00:00Z"),
      ],
    ],
  ]);
  const items = buildMentionActivity(me.email, refs(task("t1")), threads);

  it("counts everything when never seen", () => {
    expect(countUnseenActivity(items, null)).toBe(2);
  });

  it("counts only items after the last-seen timestamp", () => {
    expect(countUnseenActivity(items, "2026-07-02T00:00:00Z")).toBe(1);
    expect(countUnseenActivity(items, "2026-07-04T00:00:00Z")).toBe(0);
  });
});
