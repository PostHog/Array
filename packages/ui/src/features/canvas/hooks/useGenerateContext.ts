import {
  TASK_SERVICE,
  type TaskService,
} from "@posthog/core/task-detail/taskService";
import { useService } from "@posthog/di/react";
import { buildContextGenerationPrompt } from "@posthog/ui/features/canvas/contextPrompt";
import { useChannelTaskMutations } from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import { useContextGenTaskStore } from "@posthog/ui/features/canvas/stores/contextGenTaskStore";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { toast } from "@posthog/ui/primitives/toast";
import { useCallback, useState } from "react";

// Kicks off CONTEXT.md generation as a normal task in the channel's repo. The
// task is filed to the channel and recorded as the channel's generation task so
// the CONTEXT.md view can track its status. Returns the created task id.
export function useGenerateContext(channelId: string, channelName: string) {
  const taskService = useService<TaskService>(TASK_SERVICE);
  const { invalidateTasks } = useCreateTask();
  const { fileTask } = useChannelTaskMutations();
  const setTask = useContextGenTaskStore((s) => s.setTask);
  const [isStarting, setIsStarting] = useState(false);

  const generate = useCallback(
    async (repoPath: string): Promise<string | null> => {
      setIsStarting(true);
      try {
        const result = await taskService.createTask(
          {
            content: buildContextGenerationPrompt({ channelName, channelId }),
            taskDescription: `Generate CONTEXT.md for #${channelName}`,
            repoPath,
            workspaceMode: "local",
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
        setTask(channelId, task.id);
        // File into the channel so it shows up alongside the channel's tasks.
        void fileTask(channelId, task.id, task.title).catch(() => {});
        return task.id;
      } finally {
        setIsStarting(false);
      }
    },
    [taskService, invalidateTasks, fileTask, setTask, channelId, channelName],
  );

  return { generate, isStarting };
}
