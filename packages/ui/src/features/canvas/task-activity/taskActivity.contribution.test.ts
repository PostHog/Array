import type { TaskActivityPage } from "@posthog/shared/domain-types";
import type { NotificationBus } from "@posthog/ui/features/notifications/notifications";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskActivityContribution } from "./taskActivity.contribution";
import { TASK_ACTIVITY_QUERY_KEY } from "./taskActivityQuery";

const notify = vi.fn();
let completionListener: ((taskId?: string) => void) | undefined;
const notificationBus = {
  notify,
  subscribeToTaskCompletion: vi.fn((listener: (taskId?: string) => void) => {
    completionListener = listener;
    return vi.fn();
  }),
} as unknown as NotificationBus;

describe("TaskActivityContribution", () => {
  let queryClient: QueryClient;
  let contribution: TaskActivityContribution;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    queryClient = new QueryClient();
    contribution = new TaskActivityContribution(notificationBus, queryClient);
    contribution.start();
  });

  afterEach(() => vi.useRealTimers());

  it("refreshes activity immediately and reconciles after session completion", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    completionListener?.("task-1");
    expect(invalidate).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(2_000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("notifies when a tracked channel task reaches completed activity", () => {
    contribution.track({ id: "task-1", title: "Channel task" });
    const page: TaskActivityPage = {
      results: [
        {
          id: "activity-1",
          task_id: "task-1",
          task_title: "Channel task",
          activity_at: "2026-07-27T10:00:00Z",
          activity_kind: "completed",
          snippet: "",
          is_unread: true,
        },
      ],
      unread_count: 1,
    };

    queryClient.setQueryData(TASK_ACTIVITY_QUERY_KEY, {
      pages: [page],
      pageParams: [undefined],
    });

    expect(notify).toHaveBeenCalledWith({
      body: '"Channel task" finished',
      target: { kind: "task", taskId: "task-1" },
      toast: { level: "success" },
    });
  });
});
