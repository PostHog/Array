import {
  ARCHIVED_TASKS_CONTROLLER,
  type ArchivedTasksController,
  type ContextMenuOutcome,
  type DeleteOutcome,
  type RestoreOutcome,
} from "@posthog/core/archive/archivedTasksController";
import { useService } from "@posthog/di/react";
import { useHostTRPC } from "@posthog/host-router/react";
import { WORKSPACE_QUERY_KEY } from "@posthog/ui/features/workspace/identifiers";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export interface UseUnarchiveTask {
  restore(
    taskId: string,
    hasTask: boolean,
    options?: { recreateBranch?: boolean },
  ): Promise<RestoreOutcome>;
  remove(taskId: string): Promise<DeleteOutcome>;
  runContextMenuAction(
    taskId: string,
    taskTitle: string,
    hasTask: boolean,
  ): Promise<ContextMenuOutcome>;
}

export function useUnarchiveTask(): UseUnarchiveTask {
  const controller = useService<ArchivedTasksController>(
    ARCHIVED_TASKS_CONTROLLER,
  );
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();

  const invalidateArchiveQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.archive.pathFilter()),
      queryClient.refetchQueries({ queryKey: ["tasks"] }),
    ]);
  }, [queryClient, trpc]);

  const invalidateOnRestore = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: WORKSPACE_QUERY_KEY });
    await invalidateArchiveQueries();
  }, [queryClient, invalidateArchiveQueries]);

  const restore = useCallback(
    async (
      taskId: string,
      hasTask: boolean,
      options?: { recreateBranch?: boolean },
    ) => {
      const outcome = await controller.restore(taskId, hasTask, options);
      if (outcome.kind === "restored") {
        await invalidateOnRestore();
      }
      return outcome;
    },
    [controller, invalidateOnRestore],
  );

  const remove = useCallback(
    async (taskId: string) => {
      const outcome = await controller.remove(taskId);
      if (outcome.kind === "deleted") {
        await invalidateArchiveQueries();
      }
      return outcome;
    },
    [controller, invalidateArchiveQueries],
  );

  const runContextMenuAction = useCallback(
    async (taskId: string, taskTitle: string, hasTask: boolean) => {
      const outcome = await controller.runContextMenuAction(
        taskId,
        taskTitle,
        hasTask,
      );
      if (outcome.kind === "restore" && outcome.outcome.kind === "restored") {
        await invalidateOnRestore();
      } else if (
        outcome.kind === "delete" &&
        outcome.outcome.kind === "deleted"
      ) {
        await invalidateArchiveQueries();
      }
      return outcome;
    },
    [controller, invalidateOnRestore, invalidateArchiveQueries],
  );

  return { restore, remove, runContextMenuAction };
}
