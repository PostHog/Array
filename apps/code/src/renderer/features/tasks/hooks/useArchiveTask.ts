import { useCommandCenterStore } from "@features/command-center/stores/commandCenterStore";
import { getSessionService } from "@features/sessions/service/service";
import { pinnedTasksApi } from "@features/sidebar/hooks/usePinnedTasks";
import { useTerminalStore } from "@features/terminal/stores/terminalStore";
import { workspaceApi } from "@features/workspace/hooks/useWorkspace";
import { trpc, trpcClient } from "@renderer/trpc";
import type { ArchivedTask } from "@shared/types/archive";
import { useFocusStore } from "@stores/focusStore";
import { useNavigationStore } from "@stores/navigationStore";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { logger } from "@utils/logger";
import { toast } from "@utils/toast";

const log = logger.scope("archive-task");

interface ArchiveTaskOptions {
  skipNavigate?: boolean;
}

export async function archiveTaskImperative(
  taskId: string,
  queryClient: QueryClient,
  options?: ArchiveTaskOptions,
): Promise<void> {
  const focusStore = useFocusStore.getState();
  const workspace = await workspaceApi.get(taskId);
  const pinnedTaskIds = await pinnedTasksApi.getPinnedTaskIds();
  const wasPinned = pinnedTaskIds.includes(taskId);

  if (!options?.skipNavigate) {
    const nav = useNavigationStore.getState();
    if (nav.view.type === "task-detail" && nav.view.data?.id === taskId) {
      nav.navigateToTaskInput();
    }
  }

  const terminalStatesSnapshot = Object.fromEntries(
    Object.entries(useTerminalStore.getState().terminalStates).filter(
      ([key]) => key === taskId || key.startsWith(`${taskId}-`),
    ),
  );
  const commandCenterState = useCommandCenterStore.getState();
  const commandCenterIndex = commandCenterState.cells.indexOf(taskId);
  const wasActiveInCommandCenter = commandCenterState.activeTaskId === taskId;

  pinnedTasksApi.unpin(taskId);
  useTerminalStore.getState().clearTerminalStatesForTask(taskId);
  useCommandCenterStore.getState().removeTaskById(taskId);

  await queryClient.cancelQueries(trpc.archive.pathFilter());

  queryClient.setQueryData<string[]>(
    trpc.archive.archivedTaskIds.queryKey(),
    (old) => (old ? [...old, taskId] : [taskId]),
  );

  const optimisticArchived: ArchivedTask = {
    taskId,
    archivedAt: new Date().toISOString(),
    folderId: workspace?.folderId ?? "",
    mode: workspace?.mode ?? "worktree",
    worktreeName: workspace?.worktreeName ?? null,
    branchName: workspace?.branchName ?? null,
    checkpointId: null,
  };
  queryClient.setQueryData<ArchivedTask[]>(
    trpc.archive.list.queryKey(),
    (old) => (old ? [...old, optimisticArchived] : [optimisticArchived]),
  );

  if (
    workspace?.worktreePath &&
    focusStore.session?.worktreePath === workspace.worktreePath
  ) {
    log.info("Unfocusing workspace before archiving");
    await focusStore.disableFocus();
  }

  try {
    await getSessionService().disconnectFromTask(taskId);

    await trpcClient.archive.archive.mutate({
      taskId,
    });

    queryClient.invalidateQueries(trpc.archive.pathFilter());
  } catch (error) {
    log.error("Failed to archive task", error);

    queryClient.setQueryData<string[]>(
      trpc.archive.archivedTaskIds.queryKey(),
      (old) => (old ? old.filter((id) => id !== taskId) : []),
    );
    queryClient.setQueryData<ArchivedTask[]>(
      trpc.archive.list.queryKey(),
      (old) => (old ? old.filter((a) => a.taskId !== taskId) : []),
    );
    if (wasPinned) {
      pinnedTasksApi.togglePin(taskId);
    }
    if (Object.keys(terminalStatesSnapshot).length > 0) {
      useTerminalStore.setState((s) => ({
        terminalStates: { ...s.terminalStates, ...terminalStatesSnapshot },
      }));
    }
    if (commandCenterIndex !== -1) {
      useCommandCenterStore.setState((s) => {
        const cells = [...s.cells];
        cells[commandCenterIndex] = taskId;
        return wasActiveInCommandCenter
          ? { cells, activeTaskId: taskId }
          : { cells };
      });
    }

    throw error;
  }
}

export async function archiveTasksImperative(
  taskIds: string[],
  queryClient: QueryClient,
): Promise<{ archived: number; failed: number }> {
  if (taskIds.length === 0) return { archived: 0, failed: 0 };

  const nav = useNavigationStore.getState();
  const idSet = new Set(taskIds);
  if (
    nav.view.type === "task-detail" &&
    nav.view.data &&
    idSet.has(nav.view.data.id)
  ) {
    nav.navigateToTaskInput();
  }

  let archived = 0;
  let failed = 0;
  for (const id of taskIds) {
    try {
      await archiveTaskImperative(id, queryClient, { skipNavigate: true });
      archived++;
    } catch {
      failed++;
    }
  }
  return { archived, failed };
}

export function useArchiveTask() {
  const queryClient = useQueryClient();

  const archiveTask = async ({ taskId }: { taskId: string }) => {
    await archiveTaskImperative(taskId, queryClient);
    toast.success("Task archived");
  };

  return { archiveTask };
}
