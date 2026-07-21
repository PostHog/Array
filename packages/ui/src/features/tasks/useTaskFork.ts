import { TASK_FORK_SERVICE } from "@posthog/core/task-detail/identifiers";
import type { TaskForkService } from "@posthog/core/task-detail/taskForkService";
import { getErrorTitle } from "@posthog/core/task-detail/taskInput";
import { useService } from "@posthog/di/react";
import { useHostTRPC } from "@posthog/host-router/react";
import type { Task, Workspace } from "@posthog/shared";
import { toastError } from "@posthog/ui/features/notifications/errorDetails";
import { useProvisioningStore } from "@posthog/ui/features/provisioning/store";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { toast } from "@posthog/ui/primitives/toast";
import { openTask } from "@posthog/ui/router/useOpenTask";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export function useTaskFork() {
  const taskForkService = useService<TaskForkService>(TASK_FORK_SERVICE);
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();
  const { removeSeededTask, seedTask } = useCreateTask();

  const seedFork = useCallback(
    (task: Task, workspace: Workspace | null) => {
      seedTask(task);
      if (workspace) {
        queryClient.setQueryData<Record<string, Workspace>>(
          trpc.workspace.getAll.queryKey(),
          (workspaces) => ({
            ...workspaces,
            [task.id]: workspace,
          }),
        );
      }
    },
    [queryClient, seedTask, trpc],
  );

  const forkTask = useCallback(
    async (sourceTask: Task): Promise<void> => {
      let seededTaskId: string | null = null;
      try {
        const result = await taskForkService.forkTask(sourceTask, {
          onTaskReady: ({ task, workspace }) => {
            seededTaskId = task.id;
            seedFork(task, workspace);
          },
        });
        if (!result.success) {
          if (seededTaskId) removeSeededTask(seededTaskId);
          toast.error("Could not fork task", { description: result.error });
          return;
        }

        seedFork(result.data.task, result.data.workspace);
        if (result.data.provisioningError) {
          useProvisioningStore
            .getState()
            .setFailed(result.data.task.id, result.data.provisioningError);
          toastError(
            getErrorTitle("workspace_creation"),
            result.data.provisioningError,
          );
        }
        await openTask(result.data.task);
      } catch (error) {
        if (seededTaskId) removeSeededTask(seededTaskId);
        toast.error("Could not fork task", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [removeSeededTask, seedFork, taskForkService],
  );

  return { forkTask };
}
