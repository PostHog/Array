import {
  TASK_SERVICE,
  type TaskService,
} from "@posthog/core/task-detail/taskService";
import { useService } from "@posthog/di/react";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

/**
 * Ensures the Pi RPC session for a task is running before the view queries
 * it. `TaskService.openTask` resumes the session idempotently (it returns
 * early when one is already live), so remounts are cheap and a dead session
 * gets restarted on the next mount.
 */
export function useEnsurePiSession(taskId: string): UseQueryResult<true> {
  const taskService = useService<TaskService>(TASK_SERVICE);

  return useQuery({
    queryKey: ["pi-session", "ensure", taskId],
    queryFn: async () => {
      const result = await taskService.openTask(taskId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return true as const;
    },
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  });
}
