import {
  TASK_SERVICE,
  type TaskService,
} from "@posthog/core/task-detail/taskService";
import { useService } from "@posthog/di/react";
import { useHostTRPC } from "@posthog/host-router/react";
import { buildContextGenerationPrompt } from "@posthog/ui/features/canvas/contextPrompt";
import { useChannelTaskMutations } from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import { useFolderGenerationTaskMutation } from "@posthog/ui/features/canvas/hooks/useFolderGenerationTask";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { toast } from "@posthog/ui/primitives/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

// Kicks off CONTEXT.md generation as a repo-less task. The user no longer picks
// a folder/repo up front — the agent decides at runtime whether it needs one and
// asks the user to clarify if it can't find the right one. The task runs in a
// per-task scratch dir (local), is filed to the channel, and recorded
// server-side as the channel's generation task so every user's CONTEXT.md view
// can track it.
export function useGenerateContext(channelId: string, channelName: string) {
  const taskService = useService<TaskService>(TASK_SERVICE);
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();
  const { invalidateTasks } = useCreateTask();
  const { fileTask } = useChannelTaskMutations();
  const { set: setGenerationTask } = useFolderGenerationTaskMutation(channelId);
  const [isStarting, setIsStarting] = useState(false);

  const generate = useCallback(async (): Promise<string | null> => {
    setIsStarting(true);
    try {
      const result = await taskService.createTask(
        {
          content: buildContextGenerationPrompt({ channelName, channelId }),
          taskDescription: `Generate CONTEXT.md for #${channelName}`,
          workspaceMode: "local",
          allowNoRepo: true,
        },
        (output) => invalidateTasks(output.task),
      );

      if (!result.success) {
        toast.error("Couldn't start CONTEXT.md generation", {
          description: result.error,
        });
        return null;
      }

      const task = result.data.task;
      // File into the channel + record as the (shared) generation task. Both
      // are best-effort: a failure here shouldn't undo a started task.
      void fileTask(channelId, task.id, task.title).catch(() => {});
      void setGenerationTask(task.id).catch(() => {});
      // Repo-less tasks create no workspace row, so the usual workspace.create
      // invalidation never fires — refresh the cache so the task view resolves
      // its scratch cwd instead of showing the repo-picker prompt.
      void queryClient.invalidateQueries({
        queryKey: trpc.workspace.getAll.queryKey(),
      });
      return task.id;
    } finally {
      setIsStarting(false);
    }
  }, [
    taskService,
    trpc,
    queryClient,
    invalidateTasks,
    fileTask,
    setGenerationTask,
    channelId,
    channelName,
  ]);

  return { generate, isStarting };
}
