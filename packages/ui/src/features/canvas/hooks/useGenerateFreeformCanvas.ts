import { TITLE_GENERATOR_SERVICE } from "@posthog/core/sessions/titleGeneratorIdentifiers";
import type { TitleGeneratorService } from "@posthog/core/sessions/titleGeneratorService";
import {
  TASK_SERVICE,
  type TaskService,
} from "@posthog/core/task-detail/taskService";
import { useService } from "@posthog/di/react";
import { buildFreeformGenerationPrompt } from "@posthog/ui/features/canvas/freeformPrompt";
import { useChannelTaskMutations } from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import {
  isPlaceholderCanvasName,
  useDashboardMutations,
} from "@posthog/ui/features/canvas/hooks/useDashboards";
import type { GenerateContextTarget } from "@posthog/ui/features/canvas/hooks/useGenerateContext";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { toast } from "@posthog/ui/primitives/toast";
import { useCallback, useState } from "react";

// Where the canvas-generation task runs: a local clone or a connected GitHub
// repo (cloud). Same shape as CONTEXT.md generation — canvas gen doesn't read
// repo code, but the task system is repo-bound, so it runs in the channel repo.
export type { GenerateContextTarget as GenerateCanvasTarget } from "@posthog/ui/features/canvas/hooks/useGenerateContext";

// Kicks off freeform canvas generation as a normal task (local or cloud), files
// it to the channel, and records it as the canvas's generation task (in the
// canvas's meta) so every client's canvas view tracks the in-flight run. The
// agent publishes the result via the `desktop-file-system-canvas-partial-update`
// MCP tool — mirrors useGenerateContext.
export function useGenerateFreeformCanvas(args: {
  dashboardId: string;
  channelId: string;
  name: string;
  channelName: string;
  templateId?: string;
}) {
  const { dashboardId, channelId, name, channelName, templateId } = args;
  const taskService = useService<TaskService>(TASK_SERVICE);
  const titleGenerator = useService<TitleGeneratorService>(
    TITLE_GENERATOR_SERVICE,
  );
  const { invalidateTasks } = useCreateTask();
  const { fileTask } = useChannelTaskMutations();
  const { setGenerationTask, renameDashboard } = useDashboardMutations();
  const [isStarting, setIsStarting] = useState(false);

  const generate = useCallback(
    async (
      target: GenerateContextTarget,
      opts: { instruction: string; currentCode?: string },
    ): Promise<string | null> => {
      setIsStarting(true);
      try {
        const base = {
          content: buildFreeformGenerationPrompt({
            dashboardId,
            name,
            channelName,
            templateId,
            instruction: opts.instruction,
            currentCode: opts.currentCode,
          }),
          taskDescription: `Generate canvas "${name}"`,
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
          toast.error("Couldn't start canvas generation", {
            description: result.error,
          });
          return null;
        }

        const task = result.data.task;
        // File into the channel + record as the canvas's generation task. Both
        // are best-effort: a failure here shouldn't undo a started task.
        void fileTask(channelId, task.id, task.title).catch(() => {});
        void setGenerationTask(dashboardId, task.id).catch(() => {});
        // Auto-name a still-unnamed canvas from its generation prompt, using the
        // same helper model that names tasks. Best-effort: a failure (or a user
        // who already named the canvas) leaves the existing title untouched.
        if (isPlaceholderCanvasName(name)) {
          void titleGenerator
            .generateCanvasName(opts.instruction)
            .then(async (generated) => {
              const title = generated?.trim();
              if (title) await renameDashboard(dashboardId, title);
            })
            .catch(() => {});
        }
        return task.id;
      } finally {
        setIsStarting(false);
      }
    },
    [
      taskService,
      titleGenerator,
      invalidateTasks,
      fileTask,
      setGenerationTask,
      renameDashboard,
      dashboardId,
      channelId,
      name,
      channelName,
      templateId,
    ],
  );

  return { generate, isStarting };
}
