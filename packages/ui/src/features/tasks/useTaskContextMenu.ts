import {
  resolveExternalAppPath,
  resolveTaskContextMenuIntent,
} from "@posthog/core/tasks/contextMenuActions";
import { useHostTRPCClient } from "@posthog/host-router/react";
import type { Task } from "@posthog/shared/domain-types";
import { useArchiveTask } from "@posthog/ui/features/archive/useArchiveTask";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useChannelTaskMutations } from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import { useExternalAppAction } from "@posthog/ui/features/external-apps/useExternalAppAction";
import { useRestoreTask } from "@posthog/ui/features/suspension/useRestoreTask";
import { useSuspendTask } from "@posthog/ui/features/suspension/useSuspendTask";
import { useDeleteTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { toast } from "@posthog/ui/primitives/toast";
import { logger } from "@posthog/ui/shell/logger";
import { useCallback, useState } from "react";

const log = logger.scope("context-menu");

export function useTaskContextMenu() {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const hostClient = useHostTRPCClient();
  const openExternalApp = useExternalAppAction();
  const { deleteWithConfirm } = useDeleteTask();
  const { archiveTask } = useArchiveTask();
  const { suspendTask } = useSuspendTask();
  const { restoreTask } = useRestoreTask();
  const { channels } = useChannels();
  const { fileTask } = useChannelTaskMutations();

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
        onArchive?: (taskId: string) => void;
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
        onArchive,
        onArchivePrior,
        onAddToCommandCenter,
      } = options ?? {};

      try {
        const result = await hostClient.contextMenu.showTaskContextMenu.mutate({
          taskTitle: task.title,
          worktreePath,
          folderPath,
          isPinned,
          isSuspended,
          isInCommandCenter,
          hasEmptyCommandCenterCell,
          channels: channels.map(({ id, name }) => ({ id, name })),
        });

        if (!result.action) return;

        const intent = resolveTaskContextMenuIntent(result.action, {
          isSuspended,
        });

        switch (intent.type) {
          case "rename":
            setEditingTaskId(task.id);
            break;
          case "pin":
            onTogglePin?.();
            break;
          case "suspend":
            await suspendTask({ taskId: task.id, reason: "manual" });
            break;
          case "restore":
            await restoreTask(task.id);
            break;
          case "archive":
            if (onArchive) {
              onArchive(task.id);
            } else {
              await archiveTask({ taskId: task.id });
            }
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
          case "file-to-channel":
            try {
              await fileTask(intent.channelId, task.id, task.title);
            } catch (error) {
              toast.error("Couldn't file task to channel", {
                description:
                  error instanceof Error ? error.message : String(error),
              });
            }
            break;
          case "external-app": {
            const effectivePath = resolveExternalAppPath(
              worktreePath,
              folderPath,
            );
            if (effectivePath) {
              const workspaces = await hostClient.workspace.getAll.query();
              const workspace = workspaces[task.id] ?? null;
              await openExternalApp(intent.action, effectivePath, task.title, {
                workspace,
                mainRepoPath: workspace?.folderPath,
              });
            }
            break;
          }
        }
      } catch (error) {
        log.error("Failed to show context menu", error);
      }
    },
    [
      archiveTask,
      channels,
      deleteWithConfirm,
      fileTask,
      restoreTask,
      suspendTask,
      hostClient,
      openExternalApp,
    ],
  );

  return {
    showContextMenu,
    editingTaskId,
    setEditingTaskId,
  };
}
