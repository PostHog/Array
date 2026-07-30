import type { TaskMention } from "@posthog/shared/domain-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MentionNotificationsContribution } from "./mentionNotifications.contribution";
import type { NotificationBus } from "./notifications";

function mention(overrides: Partial<TaskMention>): TaskMention {
  return {
    id: "mention-1",
    message_id: "message-1",
    task_id: "task-1",
    task_title: "Fix flaky tests",
    author: {
      id: 2,
      uuid: "user-2",
      first_name: "Charles",
      last_name: "V",
      email: "charles@posthog.com",
    },
    content: "@[Adam](adam@posthog.com) can you look?",
    created_at: "2026-07-30T10:00:00Z",
    ...overrides,
  };
}

const notify = vi.fn();
const bus = { notify } as unknown as NotificationBus;

describe("MentionNotificationsContribution", () => {
  let contribution: MentionNotificationsContribution;
  let mentionsByTick: TaskMention[][];
  let sinceByTick: (string | undefined)[];

  beforeEach(() => {
    vi.clearAllMocks();
    mentionsByTick = [];
    sinceByTick = [];
    contribution = new MentionNotificationsContribution(bus);
    contribution.getClient = async () => ({
      getTaskMentions: async (options?: { since?: string }) => {
        sinceByTick.push(options?.since);
        return mentionsByTick.shift() ?? [];
      },
    });
  });

  it("absorbs the first fetch silently, then notifies new mentions with a task target", async () => {
    mentionsByTick = [
      [mention({ message_id: "old", created_at: "2026-07-30T09:00:00Z" })],
      [mention({ message_id: "new", created_at: "2026-07-30T10:00:00Z" })],
    ];

    await contribution.tick();
    expect(notify).not.toHaveBeenCalled();
    expect(sinceByTick[0]).toBeUndefined();

    await contribution.tick();
    expect(sinceByTick[1]).toBe("2026-07-30T09:00:00Z");
    expect(notify).toHaveBeenCalledExactlyOnceWith({
      body: 'Charles V mentioned you in "Fix flaky tests"',
      target: { kind: "task", taskId: "task-1" },
      toast: { level: "warning", description: "@Adam can you look?" },
    });
  });

  it("collapses a burst into one summary notification", async () => {
    mentionsByTick = [
      [],
      Array.from({ length: 4 }, (_, i) =>
        mention({
          message_id: `m${i}`,
          created_at: `2026-07-30T10:0${i}:00Z`,
        }),
      ),
    ];

    await contribution.tick();
    await contribution.tick();
    expect(notify).toHaveBeenCalledExactlyOnceWith({
      body: "4 new mentions from teammates",
      toast: { level: "warning" },
    });
  });

  it("re-baselines after logout so another account's backlog stays silent", async () => {
    mentionsByTick = [
      [],
      [mention({ message_id: "backlog", created_at: "2026-07-30T10:00:00Z" })],
    ];
    await contribution.tick();

    const client = contribution.getClient;
    contribution.getClient = async () => null;
    await contribution.tick();

    contribution.getClient = client;
    await contribution.tick();
    expect(notify).not.toHaveBeenCalled();
    expect(sinceByTick).toEqual([undefined, undefined]);
  });

  it("falls back to 'Someone' for agent-authored mentions", async () => {
    mentionsByTick = [
      [],
      [
        mention({
          message_id: "agent",
          author: null,
          created_at: "2026-07-30T10:00:00Z",
        }),
      ],
    ];
    await contribution.tick();
    await contribution.tick();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Someone mentioned you in "Fix flaky tests"',
      }),
    );
  });

  it("keeps polling after a failed fetch", async () => {
    contribution.getClient = async () => ({
      getTaskMentions: async () => {
        throw new Error("network down");
      },
    });
    await contribution.tick();

    mentionsByTick = [[], []];
    contribution.getClient = async () => ({
      getTaskMentions: async (options?: { since?: string }) => {
        sinceByTick.push(options?.since);
        return mentionsByTick.shift() ?? [];
      },
    });
    await contribution.tick();
    expect(sinceByTick[0]).toBeUndefined();
  });
});
