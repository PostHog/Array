import {
  type TaskActivityItem,
  toTaskActivityItems,
} from "@posthog/core/canvas/taskActivity";
import { useServiceOptional } from "@posthog/di/react";
import type { TaskActivityPage } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/useCurrentUser";
import { NotificationBus } from "@posthog/ui/features/notifications/notifications";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

const ACTIVITY_POLL_INTERVAL_MS = 60_000;
const COMPLETION_RECONCILE_DELAY_MS = 2_000;
export const TASK_ACTIVITY_QUERY_KEY = ["task-activity"] as const;

export function TaskActivityNotificationSync(): null {
  const notificationBus = useServiceOptional<NotificationBus>(NotificationBus);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!notificationBus) return;
    let reconcileTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = notificationBus.subscribeToTaskCompletion(() => {
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
  }, [notificationBus, queryClient]);

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
