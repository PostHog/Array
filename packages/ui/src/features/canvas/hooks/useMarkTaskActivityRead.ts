import type { TaskActivityPage } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { TASK_ACTIVITY_QUERY_KEY } from "@posthog/ui/features/canvas/hooks/useTaskActivity";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Clear the unread flag on specific tasks. Read state lives per task on the server,
 * so this is also what the server does when the user reaches a task by any other
 * route — the optimistic update here just saves a round trip.
 */
export function useMarkTaskActivityRead() {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskIds: string[]) => {
      if (!client) throw new Error("Not authenticated");
      if (taskIds.length === 0) return;
      await client.markTaskActivityRead(taskIds);
    },
    onMutate: async (taskIds: string[]) => {
      const marked = new Set(taskIds);
      queryClient.setQueryData<TaskActivityPage>(
        TASK_ACTIVITY_QUERY_KEY,
        (page) => {
          if (!page) return page;
          const clearing = page.results.filter(
            (row) => row.is_unread && marked.has(row.task_id),
          ).length;
          return {
            ...page,
            unread_count: Math.max(0, page.unread_count - clearing),
            results: page.results.map((row) =>
              marked.has(row.task_id) ? { ...row, is_unread: false } : row,
            ),
          };
        },
      );
    },
    // The server owns the count (it spans tasks past this page), so reconcile once
    // the write lands rather than trusting the optimistic subtraction.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TASK_ACTIVITY_QUERY_KEY });
    },
  });
}
