import { useRestoreTask } from "@features/suspension/hooks/useRestoreTask";
import { useSuspendTask } from "@features/suspension/hooks/useSuspendTask";
import { useArchiveTask } from "@features/tasks/hooks/useArchiveTask";
import { useDeleteTask } from "@features/tasks/hooks/useTasks";
import { workspaceApi } from "@features/workspace/hooks/useWorkspace";
import { trpcClient } from "@renderer/trpc/client";
import type { Task } from "@shared/types";
import { handleExternalAppAction } from "@utils/handleExternalAppAction";
import { logger } from "@utils/logger";
import { useCallback, useState } from "react";

const log = logger.scope("context-menu");

export function useTaskContextMenu() {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const { deleteWithConfirm } = useDeleteTask();
  const { archiveTask } = useArchiveTask();
  const { suspendTask } = useSuspendTask();
  const { restoreTask } = useRestoreTask();

  const showContextMenu = useCallback(
    async (
      task: Task,
      event: React.MouseEvent,
      options?: {
        worktreePath?: string;
        folderPath?: string;
        isPinned?: boolean;
        isSuspended?: boolean;
        isInCommandCenter?: boolean;
        hasEmptyCommandCenterCell?: boolean;
        onTogglePin?: () => void;
        onArchivePrior?: (taskId: string) => void;
        onAddToCommandCenter?: () => void;
      },
    ) => {
      event.preventDefault();
      event.stopPropagation();

      const {
        worktreePath,
        folderPath,
        isPinned,
        isSuspended,
        isInCommandCenter,
        hasEmptyCommandCenterCell,
        onTogglePin,
        onArchivePrior,
        onAddToCommandCenter,
      } = options ?? {};

      try {
        const result = await trpcClient.contextMenu.showTaskContextMenu.mutate({
          taskTitle: task.title,
          worktreePath,
          folderPath,
          isPinned,
          isSuspended,
          isInCommandCenter,
          hasEmptyCommandCenterCell,
        });

        if (!result.action) return;

        switch (result.action.type) {
          case "rename":
            setEditingTaskId(task.id);
            break;
          case "pin":
            onTogglePin?.();
            break;
          case "suspend":
            if (isSuspended) {
              await restoreTask(task.id);
            } else {
              await suspendTask({ taskId: task.id, reason: "manual" });
            }
            break;
          case "archive":
            await archiveTask({ taskId: task.id });
            break;
          case "archive-prior":
            await onArchivePrior?.(task.id);
            break;
          case "delete":
            await deleteWithConfirm({
              taskId: task.id,
              taskTitle: task.title,
              hasWorktree: !!worktreePath,
            });
            break;
          case "add-to-command-center":
            onAddToCommandCenter?.();
            break;
          case "external-app": {
            const effectivePath = worktreePath ?? folderPath;
            if (effectivePath) {
              const workspace = await workspaceApi.get(task.id);
              await handleExternalAppAction(
                result.action.action,
                effectivePath,
                task.title,
                {
                  workspace,
                  mainRepoPath: workspace?.folderPath,
                },
              );
            }
            break;
          }
        }
      } catch (error) {
        log.error("Failed to show context menu", error);
      }
    },
    [archiveTask, deleteWithConfirm, restoreTask, suspendTask],
  );

  return {
    showContextMenu,
    editingTaskId,
    setEditingTaskId,
  };
}
