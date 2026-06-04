import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useTaskViewed } from "@features/sidebar/hooks/useTaskViewed";
import type { TaskService } from "@features/task-detail/service/service";
import { openTask as openTaskHelper } from "@hooks/useOpenTask";
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import { trpcClient, useTRPC } from "@renderer/trpc";
import type { Task } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { logger } from "@utils/logger";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

const log = logger.scope("task-deep-link");

const taskKeys = {
  all: ["tasks"] as const,
  lists: () => [...taskKeys.all, "list"] as const,
  list: (filters?: { repository?: string }) =>
    [...taskKeys.lists(), filters] as const,
};

/**
 * Hook that subscribes to deep link events and handles opening tasks.
 * Uses TaskService to fetch task and set up workspace via the saga pattern.
 */
export function useTaskDeepLink() {
  const trpcReact = useTRPC();
  const { markAsViewed } = useTaskViewed();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStateValue(
    (state) => state.status === "authenticated",
  );
  const hasFetchedPending = useRef(false);

  const handleOpenTask = useCallback(
    async (taskId: string, taskRunId?: string) => {
      log.info(
        `Opening task from deep link: ${taskId}${taskRunId ? `, run: ${taskRunId}` : ""}`,
      );

      try {
        const taskService = get<TaskService>(RENDERER_TOKENS.TaskService);
        const result = await taskService.openTask(taskId, taskRunId);

        if (!result.success) {
          log.error("Failed to open task from deep link", {
            taskId,
            taskRunId,
            error: result.error,
            failedStep: result.failedStep,
          });
          toast.error(`Failed to open task: ${result.error}`);
          return;
        }

        const { task } = result.data;

        // Add task to query cache so it shows in sidebar
        queryClient.setQueryData<Task[]>(taskKeys.list(), (old) => {
          if (!old) return [task];
          const existingIndex = old.findIndex((t) => t.id === task.id);
          if (existingIndex >= 0) {
            const updated = [...old];
            updated[existingIndex] = task;
            return updated;
          }
          return [task, ...old];
        });

        // Invalidate to ensure sync with server
        queryClient.invalidateQueries({ queryKey: taskKeys.lists() });

        markAsViewed(taskId);
        void openTaskHelper(task);

        log.info(
          `Successfully opened task from deep link: ${taskId}${taskRunId ? `, run: ${taskRunId}` : ""}`,
        );
      } catch (error) {
        log.error("Unexpected error opening task from deep link:", error);
        toast.error("Failed to open task");
      }
    },
    [markAsViewed, queryClient],
  );

  // Check for pending deep link on mount (for cold start via deep link)
  useEffect(() => {
    if (!isAuthenticated || hasFetchedPending.current) return;

    const fetchPending = async () => {
      hasFetchedPending.current = true;
      try {
        const pending = await trpcClient.deepLink.getPendingDeepLink.query();
        if (pending) {
          log.info(
            `Found pending deep link: taskId=${pending.taskId}, taskRunId=${pending.taskRunId ?? "none"}`,
          );
          handleOpenTask(pending.taskId, pending.taskRunId);
        }
      } catch (error) {
        log.error("Failed to check for pending deep link:", error);
      }
    };

    fetchPending();
  }, [isAuthenticated, handleOpenTask]);

  // Subscribe to deep link events (for warm start via deep link)
  useSubscription(
    trpcReact.deepLink.onOpenTask.subscriptionOptions(undefined, {
      onData: (data) => {
        log.info(
          `Received deep link event: taskId=${data.taskId}, taskRunId=${data.taskRunId ?? "none"}`,
        );
        if (!data?.taskId) return;
        handleOpenTask(data.taskId, data.taskRunId);
      },
    }),
  );
}
