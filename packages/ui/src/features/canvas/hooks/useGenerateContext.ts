import {
  TASK_SERVICE,
  type TaskService,
} from "@posthog/core/task-detail/taskService";
import { useService } from "@posthog/di/react";
import { buildContextGenerationPrompt } from "@posthog/ui/features/canvas/contextPrompt";
import { useChannelTaskMutations } from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import { useFolderGenerationTaskMutation } from "@posthog/ui/features/canvas/hooks/useFolderGenerationTask";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { toast } from "@posthog/ui/primitives/toast";
import { useCallback, useState } from "react";

// Where the generation task runs: a local clone or a connected GitHub repo
// (cloud sandbox). Cloud needs the user-integration id; both omit the branch
// (defaults).
export type GenerateContextTarget =
  | { mode: "local"; repoPath: string }
  | {
      mode: "cloud";
      repository: string;
      githubUserIntegrationId: string;
      branch?: string | null;
    };

// Kicks off CONTEXT.md generation as a normal task (local or cloud) in the
// channel's repo. The task is filed to the channel and recorded server-side as
// the channel's generation task so every user's CONTEXT.md view can track it.
export function useGenerateContext(channelId: string, channelName: string) {
  const taskService = useService<TaskService>(TASK_SERVICE);
  const { invalidateTasks } = useCreateTask();
  const { fileTask } = useChannelTaskMutations();
  const { set: setGenerationTask } = useFolderGenerationTaskMutation(channelId);
  const [isStarting, setIsStarting] = useState(false);

  const generate = useCallback(
    async (target: GenerateContextTarget): Promise<string | null> => {
      setIsStarting(true);
      try {
        const base = {
          content: buildContextGenerationPrompt({ channelName, channelId }),
          taskDescription: `Generate CONTEXT.md for #${channelName}`,
        };
        const result = await taskService.createTask(
          target.mode === "cloud"
            ? {
                ...base,
                repository: target.repository,
                githubUserIntegrationId: target.githubUserIntegrationId,
                workspaceMode: "cloud",
                branch: target.branch ?? null,
              }
            : {
                ...base,
                repoPath: target.repoPath,
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
        // File into the channel + record as the (shared) generation task. Both
        // are best-effort: a failure here shouldn't undo a started task.
        void fileTask(channelId, task.id, task.title).catch(() => {});
        void setGenerationTask(task.id).catch(() => {});
        return task.id;
      } finally {
        setIsStarting(false);
      }
    },
    [
      taskService,
      invalidateTasks,
      fileTask,
      setGenerationTask,
      channelId,
      channelName,
    ],
  );

  return { generate, isStarting };
}
