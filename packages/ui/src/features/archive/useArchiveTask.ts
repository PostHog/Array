import {
  type ArchiveCacheWriter,
  type ArchiveOrchestrationDeps,
  type ArchiveTasksResult,
  archiveTask,
  archiveTasks,
  shouldNavigateAwayForBulkArchive,
} from "@posthog/core/archive/archiveOrchestration";
import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { resolveService } from "@posthog/di/container";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import { useHostTRPC } from "@posthog/host-router/react";
import { useCommandCenterStore } from "@posthog/ui/features/command-center/commandCenterStore";
import { useFocusStore } from "@posthog/ui/features/focus/focusStore";
import { pinnedTasksApi } from "@posthog/ui/features/sidebar/taskMetaApi";
import {
  type TerminalState,
  useTerminalStore,
} from "@posthog/ui/features/terminal/terminalStore";
import { toast } from "@posthog/ui/primitives/toast";
import { getAppViewSnapshot } from "@posthog/ui/router/useAppView";
import { openTaskInput } from "@posthog/ui/router/useOpenTask";
import { logger } from "@posthog/ui/shell/logger";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

const log = logger.scope("archive-task");

export interface ArchiveCacheKeys {
  archivedTaskIdsQueryKey: readonly unknown[];
  archiveListQueryKey: readonly unknown[];
  archivePathFilterKey: readonly unknown[];
}

export function useArchiveCacheKeys(): ArchiveCacheKeys {
  const trpc = useHostTRPC();
  return useMemo(
    () => ({
      archivedTaskIdsQueryKey: trpc.archive.archivedTaskIds.queryKey(),
      archiveListQueryKey: trpc.archive.list.queryKey(),
      archivePathFilterKey: trpc.archive.pathFilter().queryKey,
    }),
    [trpc],
  );
}

function makeCacheWriter(
  queryClient: QueryClient,
  keys: ArchiveCacheKeys,
): ArchiveCacheWriter {
  return {
    cancelPathFilter: () =>
      queryClient.cancelQueries({ queryKey: keys.archivePathFilterKey }),
    invalidatePathFilter: () => {
      queryClient.invalidateQueries({ queryKey: keys.archivePathFilterKey });
    },
    setArchivedTaskIds: (updater) =>
      queryClient.setQueryData(keys.archivedTaskIdsQueryKey, updater),
    setArchiveList: (updater) =>
      queryClient.setQueryData(keys.archiveListQueryKey, updater),
  };
}

function makeOrchestrationDeps(
  queryClient: QueryClient,
  keys: ArchiveCacheKeys,
  options?: { skipNavigate?: boolean },
): ArchiveOrchestrationDeps {
  const hostClient = resolveService<HostTrpcClient>(HOST_TRPC_CLIENT);
  return {
    async getWorkspace(taskId) {
      const all = await hostClient.workspace.getAll.query();
      return all[taskId] ?? null;
    },
    getPinnedTaskIds: () => pinnedTasksApi.getPinnedTaskIds(),
    unpin: (taskId) => pinnedTasksApi.unpin(taskId),
    togglePin: async (taskId) => {
      await pinnedTasksApi.togglePin(taskId);
    },
    navigateAwayFromTaskIfActive: (taskId) => {
      if (options?.skipNavigate) return;
      const view = getAppViewSnapshot();
      if (view.type === "task-detail" && view.taskId === taskId) {
        openTaskInput();
      }
    },
    snapshotTerminalStates: (taskId) =>
      Object.fromEntries(
        Object.entries(useTerminalStore.getState().terminalStates).filter(
          ([key]) => key === taskId || key.startsWith(`${taskId}-`),
        ),
      ),
    clearTerminalStates: (taskId) =>
      useTerminalStore.getState().clearTerminalStatesForTask(taskId),
    restoreTerminalStates: (states) => {
      useTerminalStore.setState((s) => ({
        terminalStates: {
          ...s.terminalStates,
          ...(states as Record<string, TerminalState>),
        },
      }));
    },
    snapshotCommandCenter: (taskId) => {
      const state = useCommandCenterStore.getState();
      return {
        index: state.cells.indexOf(taskId),
        wasActive: state.activeTaskId === taskId,
      };
    },
    removeFromCommandCenter: (taskId) =>
      useCommandCenterStore.getState().removeTaskById(taskId),
    restoreCommandCenter: (taskId, snapshot) => {
      useCommandCenterStore.setState((s) => {
        const cells = [...s.cells];
        cells[snapshot.index] = taskId;
        return snapshot.wasActive ? { cells, activeTaskId: taskId } : { cells };
      });
    },
    getFocusedWorktreePath: () =>
      useFocusStore.getState().session?.worktreePath,
    disableFocus: async () => {
      log.info("Unfocusing workspace before archiving");
      await useFocusStore.getState().disableFocus();
    },
    disconnectFromTask: (taskId) =>
      resolveService<SessionService>(SESSION_SERVICE).disconnectFromTask(
        taskId,
      ),
    archive: (taskId) =>
      hostClient.archive.archive.mutate({ taskId }).then(() => undefined),
    logError: (message, error) => log.error(message, error),
    cache: makeCacheWriter(queryClient, keys),
  };
}

export async function archiveTaskImperative(
  taskId: string,
  queryClient: QueryClient,
  keys: ArchiveCacheKeys,
  options?: { skipNavigate?: boolean },
): Promise<void> {
  await archiveTask(
    taskId,
    makeOrchestrationDeps(queryClient, keys, options),
    options,
  );
}

export async function archiveTasksImperative(
  taskIds: string[],
  queryClient: QueryClient,
  keys: ArchiveCacheKeys,
): Promise<ArchiveTasksResult> {
  const view = getAppViewSnapshot();
  const activeTaskId =
    view.type === "task-detail" ? (view.taskId ?? null) : null;
  if (shouldNavigateAwayForBulkArchive(taskIds, activeTaskId)) {
    openTaskInput();
  }
  return archiveTasks(
    taskIds,
    makeOrchestrationDeps(queryClient, keys, { skipNavigate: true }),
  );
}

export function useArchiveTask() {
  const queryClient = useQueryClient();
  const keys = useArchiveCacheKeys();

  const archiveTask = async ({ taskId }: { taskId: string }) => {
    await archiveTaskImperative(taskId, queryClient, keys);
    toast.success("Task archived");
  };

  return { archiveTask };
}
