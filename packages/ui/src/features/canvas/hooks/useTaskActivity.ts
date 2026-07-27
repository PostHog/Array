import {
  type TaskActivityItem,
  toTaskActivityItems,
} from "@posthog/core/canvas/taskActivity";
import { useServiceOptional } from "@posthog/di/react";
import type { TaskActivityPage } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/useCurrentUser";
import { useTaskCompletionTrackerStore } from "@posthog/ui/features/canvas/stores/taskCompletionTrackerStore";
import { NotificationBus } from "@posthog/ui/features/notifications/notifications";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

const ACTIVITY_POLL_INTERVAL_MS = 60_000;
const COMPLETION_RECONCILE_DELAY_MS = 2_000;
const TRACKED_TASK_POLL_INTERVAL_MS = 4_000;
const TRACKED_TASK_MAX_AGE_MS = 15 * 60_000;
export const TASK_ACTIVITY_QUERY_KEY = ["task-activity"] as const;

export function TaskActivityNotificationSync(): null {
  const notificationBus = useServiceOptional<NotificationBus>(NotificationBus);
  const queryClient = useQueryClient();
  const trackedTasks = useTaskCompletionTrackerStore((state) => state.tracked);
  const untrackTask = useTaskCompletionTrackerStore((state) => state.untrack);
  const trackedTaskIds = Object.keys(trackedTasks);
  const { items } = useTaskActivity({ enabled: trackedTaskIds.length > 0 });

  useEffect(() => {
    if (!notificationBus) return;
    let reconcileTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = notificationBus.subscribeToTaskCompletion((taskId) => {
      if (taskId) untrackTask(taskId);
      void queryClient.invalidateQueries({ queryKey: TASK_ACTIVITY_QUERY_KEY });
      clearTimeout(reconcileTimer);
      reconcileTimer = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: TASK_ACTIVITY_QUERY_KEY,
        });
      }, COMPLETION_RECONCILE_DELAY_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(reconcileTimer);
    };
  }, [notificationBus, queryClient, untrackTask]);

  useEffect(() => {
    if (trackedTaskIds.length === 0) return;
    void queryClient.invalidateQueries({ queryKey: TASK_ACTIVITY_QUERY_KEY });
    const interval = setInterval(() => {
      const cutoff = Date.now() - TRACKED_TASK_MAX_AGE_MS;
      for (const tracked of Object.values(
        useTaskCompletionTrackerStore.getState().tracked,
      )) {
        if (tracked.trackedAt < cutoff) untrackTask(tracked.taskId);
      }
      void queryClient.invalidateQueries({ queryKey: TASK_ACTIVITY_QUERY_KEY });
    }, TRACKED_TASK_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [queryClient, trackedTaskIds.length, untrackTask]);

  useEffect(() => {
    if (!notificationBus) return;
    for (const item of items) {
      const tracked = trackedTasks[item.taskId];
      if (!tracked || item.activityKind !== "completed") continue;
      untrackTask(item.taskId);
      notificationBus.notify({
        body: `"${tracked.title}" finished`,
        target: { kind: "task", taskId: item.taskId },
        toast: { level: "success" },
      });
    }
  }, [items, notificationBus, trackedTasks, untrackTask]);

  return null;
}

/**
 * Tasks the current user is involved in — created, @-mentioned in, or messaged
 * in — one row per task, newest activity first, from the backend task-activity
 * index. Mount once per surface (sidebar badge, Activity page) — results are
 * shared through the react-query cache.
 */
export function useTaskActivity(options?: { enabled?: boolean }): {
  items: TaskActivityItem[];
  unreadCount: number;
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
} {
  const client = useOptionalAuthenticatedClient();
  const query = useInfiniteQuery({
    queryKey: TASK_ACTIVITY_QUERY_KEY,
    queryFn: ({ pageParam }) => {
      if (!client) throw new Error("Not authenticated");
      return client.getTaskActivity(pageParam);
    },
    initialPageParam: undefined as
      | { before: string; beforeId: string }
      | undefined,
    getNextPageParam: (page: TaskActivityPage) =>
      page.next_before && page.next_before_id
        ? { before: page.next_before, beforeId: page.next_before_id }
        : undefined,
    enabled: !!client && (options?.enabled ?? true),
    refetchInterval: ACTIVITY_POLL_INTERVAL_MS,
    staleTime: ACTIVITY_POLL_INTERVAL_MS,
    meta: AUTH_SCOPED_QUERY_META,
  });
  const items = useMemo(
    () =>
      toTaskActivityItems(
        query.data?.pages.flatMap((page) => page.results) ?? [],
      ),
    [query.data],
  );
  return {
    items,
    unreadCount: query.data?.pages[0]?.unread_count ?? 0,
    isLoading: query.isLoading,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  };
}
