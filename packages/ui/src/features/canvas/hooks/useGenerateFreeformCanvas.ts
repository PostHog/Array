import {
  CANVAS_GENERATION_SERVICE,
  type CanvasGenerationService,
} from "@posthog/core/canvas/canvasGenerationService";
import { useService } from "@posthog/di/react";
import { useHostTRPC } from "@posthog/host-router/react";
import type { Adapter, WorkspaceMode } from "@posthog/shared";
import { useFolderInstructions } from "@posthog/ui/features/canvas/hooks/useFolderInstructions";
import { useCanvasGenerationTrackerStore } from "@posthog/ui/features/canvas/stores/canvasGenerationTrackerStore";
import { toastError } from "@posthog/ui/features/notifications/errorDetails";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

export function useGenerateFreeformCanvas(args: {
  channelId: string;
  channelName: string;
  channelContext?: string;
}) {
  const { channelId, channelName } = args;
  const generationService = useService<CanvasGenerationService>(
    CANVAS_GENERATION_SERVICE,
  );
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();
  const { invalidateTasks } = useCreateTask();
  const callerOwnsContext = "channelContext" in args;
  const { data: instructions } = useFolderInstructions(channelId, {
    enabled: !callerOwnsContext,
  });
  const channelContext = callerOwnsContext
    ? args.channelContext
    : instructions?.content;
  const [isStarting, setIsStarting] = useState(false);

  const generate = useCallback(
    async (opts: {
      dashboardId: string;
      name: string;
      templateId?: string;
      instruction: string;
      currentCode?: string;
      backendChannelId?: string;
      adapter?: Adapter;
      model?: string;
      reasoningLevel?: string;
      useStarter?: boolean;
      workspaceMode?: WorkspaceMode;
    }): Promise<string | null> => {
      setIsStarting(true);
      try {
        const result = await generationService.generate({
          ...opts,
          channelId,
          channelName,
          channelContext,
        });
        if (!result.success) {
          toastError("Couldn't start canvas generation", result.error);
          return null;
        }

        invalidateTasks(result.task);
        useCanvasGenerationTrackerStore.getState().track({
          taskId: result.taskId,
          dashboardId: opts.dashboardId,
          channelId,
          name: opts.name,
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.workspace.getAll.queryKey(),
        });
        return result.taskId;
      } finally {
        setIsStarting(false);
      }
    },
    [
      generationService,
      channelId,
      channelName,
      channelContext,
      invalidateTasks,
      queryClient,
      trpc,
    ],
  );

  return { generate, isStarting };
}
