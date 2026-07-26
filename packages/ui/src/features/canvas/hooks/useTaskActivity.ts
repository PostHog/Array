import {
  type TaskActivityItem,
  toTaskActivityItems,
} from "@posthog/core/canvas/taskActivity";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useMemo } from "react";

const ACTIVITY_POLL_INTERVAL_MS = 60_000;
const TASK_ACTIVITY_QUERY_KEY = ["task-activity"] as const;

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
} {
  const query = useAuthenticatedQuery(
    TASK_ACTIVITY_QUERY_KEY,
    (client) => client.getTaskActivity(),
    {
      enabled: options?.enabled ?? true,
      refetchInterval: ACTIVITY_POLL_INTERVAL_MS,
      staleTime: ACTIVITY_POLL_INTERVAL_MS,
    },
  );
  const items = useMemo(
    () => toTaskActivityItems(query.data?.results ?? []),
    [query.data],
  );
  return {
    items,
    unreadCount: query.data?.unread_count ?? 0,
    isLoading: query.isLoading,
  };
}
