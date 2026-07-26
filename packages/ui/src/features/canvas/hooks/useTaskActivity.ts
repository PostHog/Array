import {
  mergeTaskActivity,
  type TaskActivityItem,
  toTaskActivityItems,
} from "@posthog/core/canvas/taskActivity";
import type { TaskActivity } from "@posthog/shared/domain-types";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useQueryClient } from "@tanstack/react-query";
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
  isLoading: boolean;
} {
  const queryClient = useQueryClient();
  const query = useAuthenticatedQuery(
    TASK_ACTIVITY_QUERY_KEY,
    async (client) => {
      const previous =
        queryClient.getQueryData<TaskActivity[]>(TASK_ACTIVITY_QUERY_KEY) ?? [];
      // The most recent activity already held becomes the low-water mark, so
      // repolls ask the backend only for what changed.
      const since = previous[0]?.activity_at;
      const incoming = await client.getTaskActivity(
        since ? { since } : undefined,
      );
      return mergeTaskActivity(previous, incoming);
    },
    {
      enabled: options?.enabled ?? true,
      refetchInterval: ACTIVITY_POLL_INTERVAL_MS,
      staleTime: ACTIVITY_POLL_INTERVAL_MS,
    },
  );
  const items = useMemo(
    () => toTaskActivityItems(query.data ?? []),
    [query.data],
  );
  return { items, isLoading: query.isLoading };
}
