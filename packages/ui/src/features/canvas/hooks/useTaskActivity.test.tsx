import type {
  TaskActivity,
  TaskActivityPage,
} from "@posthog/shared/domain-types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({
  getTaskActivity: vi.fn(),
  markTaskActivityRead: vi.fn(),
}));
const subscribeToTaskCompletion = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());

vi.mock("@posthog/ui/features/auth/authClient", () => ({
  useOptionalAuthenticatedClient: () => mockClient,
}));
vi.mock("@posthog/di/react", () => ({
  useServiceOptional: () => ({ notify, subscribeToTaskCompletion }),
}));

import { useTaskCompletionTrackerStore } from "../stores/taskCompletionTrackerStore";
import { useMarkTaskActivityRead } from "./useMarkTaskActivityRead";
import {
  TASK_ACTIVITY_QUERY_KEY,
  TaskActivityNotificationSync,
  useTaskActivity,
} from "./useTaskActivity";

function activity(overrides: Partial<TaskActivity>): TaskActivity {
  return {
    id: "activity-1",
    task_id: "task-1",
    task_title: "Task",
    activity_at: "2026-07-01T10:00:00Z",
    activity_kind: "mention",
    snippet: "Ping",
    is_unread: true,
    ...overrides,
  };
}

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("task activity hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    subscribeToTaskCompletion.mockReturnValue(vi.fn());
    useTaskCompletionTrackerStore.setState({ tracked: {} });
  });

  it("invalidates activity when a task completion notification fires", () => {
    vi.useFakeTimers();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    render(<TaskActivityNotificationSync />, { wrapper });
    const listener = subscribeToTaskCompletion.mock.calls[0]?.[0];

    listener();

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: TASK_ACTIVITY_QUERY_KEY,
    });
    act(() => vi.advanceTimersByTime(2_000));
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("notifies when a channel task reaches completed activity", async () => {
    useTaskCompletionTrackerStore.getState().track({
      taskId: "task-1",
      title: "Channel task",
    });
    mockClient.getTaskActivity.mockResolvedValue({
      results: [activity({ activity_kind: "completed" })],
      unread_count: 1,
    });

    render(<TaskActivityNotificationSync />, { wrapper });

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith({
        body: '"Channel task" finished',
        target: { kind: "task", taskId: "task-1" },
        toast: { level: "success" },
      }),
    );
    expect(useTaskCompletionTrackerStore.getState().tracked).toEqual({});
  });

  it("loads every activity page", async () => {
    mockClient.getTaskActivity
      .mockResolvedValueOnce({
        results: [activity({ task_id: "task-2" })],
        unread_count: 2,
        next_before: "2026-07-01T10:00:00Z",
        next_before_id: "activity-1",
      })
      .mockResolvedValueOnce({
        results: [
          activity({
            id: "activity-2",
            task_id: "task-1",
            activity_at: "2026-06-30T10:00:00Z",
          }),
        ],
        unread_count: 2,
        next_before: null,
        next_before_id: null,
      });

    const hook = renderHook(() => useTaskActivity(), { wrapper });
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    await act(async () => {
      await hook.result.current.fetchNextPage();
    });

    await waitFor(() =>
      expect(hook.result.current.items.map((item) => item.taskId)).toEqual([
        "task-2",
        "task-1",
      ]),
    );
    expect(mockClient.getTaskActivity).toHaveBeenLastCalledWith({
      before: "2026-07-01T10:00:00Z",
      beforeId: "activity-1",
    });
  });

  it("does not optimistically clear activity newer than the marker", async () => {
    const page: TaskActivityPage = {
      results: [activity({ activity_at: "2026-07-01T11:00:00Z" })],
      unread_count: 1,
    };
    queryClient.setQueryData(TASK_ACTIVITY_QUERY_KEY, {
      pages: [page],
      pageParams: [undefined],
    });
    mockClient.markTaskActivityRead.mockResolvedValue({
      marked_read: 0,
      unread_count: 1,
    });

    const hook = renderHook(() => useMarkTaskActivityRead(), { wrapper });
    act(() => {
      hook.result.current.mutate([
        { task_id: "task-1", seen_before: "2026-07-01T10:00:00Z" },
      ]);
    });

    await waitFor(() =>
      expect(mockClient.markTaskActivityRead).toHaveBeenCalledOnce(),
    );
    const cached = queryClient.getQueryData<{
      pages: TaskActivityPage[];
    }>(TASK_ACTIVITY_QUERY_KEY);
    expect(cached?.pages[0]?.results[0]?.is_unread).toBe(true);
    expect(cached?.pages[0]?.unread_count).toBe(1);
  });
});
