import type { TaskActivityPage } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const TASK_ACTIVITY_QUERY_KEY = ["task-activity"] as const;

export function useMarkTaskActivityRead() {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Not authenticated");
      await client.markTaskActivityRead();
    },
    onSuccess: () => {
      queryClient.setQueryData<TaskActivityPage>(
        TASK_ACTIVITY_QUERY_KEY,
        (page) =>
          page
            ? {
                ...page,
                unread_count: 0,
                results: page.results.map((row) => ({
                  ...row,
                  is_unread: false,
                })),
              }
            : page,
      );
    },
  });
}
