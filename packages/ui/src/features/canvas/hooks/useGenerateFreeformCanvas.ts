import { TITLE_GENERATOR_SERVICE } from "@posthog/core/sessions/titleGeneratorIdentifiers";
import type { TitleGeneratorService } from "@posthog/core/sessions/titleGeneratorService";
import {
  TASK_SERVICE,
  type TaskService,
} from "@posthog/core/task-detail/taskService";
import { useService } from "@posthog/di/react";
import { useHostTRPC } from "@posthog/host-router/react";
import { buildFreeformGenerationPrompt } from "@posthog/ui/features/canvas/freeformPrompt";
import { useChannelTaskMutations } from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import {
  isPlaceholderCanvasName,
  useDashboardMutations,
} from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useFolderInstructions } from "@posthog/ui/features/canvas/hooks/useFolderInstructions";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { toast } from "@posthog/ui/primitives/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

// Kicks off freeform canvas generation as a repo-less task, files it to the
// channel, and records it as the canvas's generation task (in the canvas's meta)
// so every client's canvas view tracks the in-flight run. Canvas generation
// reads PostHog data via the MCP rather than repo code, so no repo is selected
// up front — the agent attaches one lazily only if it decides it needs one. The
// task runs in a per-task scratch dir (local) and the agent publishes the result
// via the `desktop-file-system-canvas-partial-update` MCP tool — mirrors
// useGenerateContext.
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
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();
  const { invalidateTasks } = useCreateTask();
  const { fileTask } = useChannelTaskMutations();
  const { setGenerationTask, renameDashboard } = useDashboardMutations();
  // The channel's CONTEXT.md, passed to the agent as optional background so the
  // generated canvas starts with the shared context. Absent/empty is fine.
  const { data: instructions } = useFolderInstructions(channelId);
  const channelContext = instructions?.content;
  const [isStarting, setIsStarting] = useState(false);

  const generate = useCallback(
    async (opts: {
      instruction: string;
      currentCode?: string;
    }): Promise<string | null> => {
      setIsStarting(true);
      try {
        const result = await taskService.createTask(
          {
            content: buildFreeformGenerationPrompt({
              dashboardId,
              name,
              channelName,
              templateId,
              instruction: opts.instruction,
              currentCode: opts.currentCode,
            }),
            taskDescription: `Generate canvas "${name}"`,
            // Unattended generation: run in auto mode so it doesn't stall on edit-approval prompts.
            executionMode: "auto" as const,
            workspaceMode: "local",
            allowNoRepo: true,
            channelContext,
            channelName,
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
        // Repo-less tasks create no workspace row, so the usual workspace.create
        // invalidation never fires — refresh the cache so the task view resolves
        // its scratch cwd instead of showing the repo-picker prompt.
        void queryClient.invalidateQueries({
          queryKey: trpc.workspace.getAll.queryKey(),
        });
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
      trpc,
      queryClient,
      invalidateTasks,
      fileTask,
      setGenerationTask,
      renameDashboard,
      dashboardId,
      channelId,
      name,
      channelName,
      templateId,
      channelContext,
    ],
  );

  return { generate, isStarting };
}
