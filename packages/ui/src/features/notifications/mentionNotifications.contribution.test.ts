import type { TaskMention } from "@posthog/shared/domain-types";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/useCurrentUser";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MentionNotificationsContribution } from "./mentionNotifications.contribution";
import type { NotificationBus } from "./notifications";

const MENTIONS_KEY = ["task-mentions"];

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
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient();
    queryClient.setQueryDefaults(MENTIONS_KEY, {
      meta: AUTH_SCOPED_QUERY_META,
    });
    new MentionNotificationsContribution(bus, queryClient).start();
  });

  it("absorbs the first page silently, then notifies new mentions with a task target", () => {
    const backlog = mention({
      message_id: "old",
      created_at: "2026-07-30T09:00:00Z",
    });
    queryClient.setQueryData(MENTIONS_KEY, [backlog]);
    expect(notify).not.toHaveBeenCalled();

    queryClient.setQueryData(MENTIONS_KEY, [
      mention({ message_id: "new", created_at: "2026-07-30T10:00:00Z" }),
      backlog,
    ]);
    expect(notify).toHaveBeenCalledExactlyOnceWith({
      body: 'Charles V mentioned you in "Fix flaky tests"',
      target: { kind: "task", taskId: "task-1" },
      muteSound: false,
      toast: { level: "warning", description: "@Adam can you look?" },
    });
  });

  it("rings once per batch: only the first delivered mention carries sound", () => {
    queryClient.setQueryData(MENTIONS_KEY, []);
    queryClient.setQueryData(MENTIONS_KEY, [
      mention({ message_id: "m2", created_at: "2026-07-30T10:02:00Z" }),
      mention({ message_id: "m1", created_at: "2026-07-30T10:01:00Z" }),
    ]);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[0][0]).toMatchObject({ muteSound: false });
    expect(notify.mock.calls[1][0]).toMatchObject({ muteSound: true });
  });

  it("hands the batch's sound to the next mention when the first is suppressed", () => {
    notify.mockReturnValueOnce("suppress");
    queryClient.setQueryData(MENTIONS_KEY, []);
    queryClient.setQueryData(MENTIONS_KEY, [
      mention({ message_id: "m2", created_at: "2026-07-30T10:02:00Z" }),
      mention({ message_id: "m1", created_at: "2026-07-30T10:01:00Z" }),
    ]);
    expect(notify.mock.calls[0][0]).toMatchObject({ muteSound: false });
    expect(notify.mock.calls[1][0]).toMatchObject({ muteSound: false });
  });

  it("does not re-notify when the query refreshes with the same data", () => {
    queryClient.setQueryData(MENTIONS_KEY, []);
    const mentions = [
      mention({ message_id: "new", created_at: "2026-07-30T10:00:00Z" }),
    ];
    queryClient.setQueryData(MENTIONS_KEY, mentions);
    queryClient.setQueryData(MENTIONS_KEY, [...mentions]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst into one summary notification", () => {
    queryClient.setQueryData(MENTIONS_KEY, []);
    queryClient.setQueryData(
      MENTIONS_KEY,
      Array.from({ length: 4 }, (_, i) =>
        mention({ message_id: `m${i}`, created_at: `2026-07-30T10:0${i}:00Z` }),
      ),
    );
    expect(notify).toHaveBeenCalledExactlyOnceWith({
      body: "4 new mentions from teammates",
      toast: { level: "warning" },
    });
  });

  it("re-baselines after the auth-scoped query is removed on logout", () => {
    queryClient.setQueryData(MENTIONS_KEY, []);
    queryClient.removeQueries({ queryKey: MENTIONS_KEY });

    queryClient.setQueryData(MENTIONS_KEY, [
      mention({ message_id: "backlog", created_at: "2026-07-30T10:00:00Z" }),
    ]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("ignores queries without the auth-scoped meta", () => {
    const bare = new QueryClient();
    new MentionNotificationsContribution(bus, bare).start();
    bare.setQueryData(MENTIONS_KEY, []);
    bare.setQueryData(MENTIONS_KEY, [
      mention({ message_id: "new", created_at: "2026-07-30T10:00:00Z" }),
    ]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("falls back to 'Someone' for agent-authored mentions", () => {
    queryClient.setQueryData(MENTIONS_KEY, []);
    queryClient.setQueryData(MENTIONS_KEY, [
      mention({
        message_id: "agent",
        author: null,
        created_at: "2026-07-30T10:00:00Z",
      }),
    ]);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Someone mentioned you in "Fix flaky tests"',
      }),
    );
  });
});
