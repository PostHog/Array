import type { ArchivedTask } from "@posthog/shared";
import {
  appendArchivedTaskId,
  appendOptimisticArchivedTask,
  buildOptimisticArchivedTask,
  type OptimisticWorkspaceInfo,
  removeArchivedTask,
  removeArchivedTaskId,
} from "./optimisticArchive";

export interface ArchiveWorkspaceInfo extends OptimisticWorkspaceInfo {
  worktreePath?: string | null;
}

export interface ArchiveCacheWriter {
  cancelPathFilter(): Promise<void>;
  invalidateArchiveList(): void;
  invalidatePathFilter(): void;
  setArchivedTaskIds(updater: (old: string[] | undefined) => string[]): void;
  setArchiveList(
    updater: (old: ArchivedTask[] | undefined) => ArchivedTask[],
  ): void;
}

export interface ArchiveOrchestrationDeps {
  getWorkspace(taskId: string): Promise<ArchiveWorkspaceInfo | null>;
  getPinnedTaskIds(): Promise<string[]>;
  unpin(taskId: string): Promise<void>;
  togglePin(taskId: string): Promise<void>;
  navigateAwayFromTaskIfActive(taskId: string): void;
  clearTerminalStates(taskId: string): void;
  snapshotCommandCenter(taskId: string): { index: number; wasActive: boolean };
  removeFromCommandCenter(taskId: string): void;
  restoreCommandCenter(
    taskId: string,
    snapshot: { index: number; wasActive: boolean },
  ): void;
  getFocusedWorktreePath(): string | null | undefined;
  disableFocus(): Promise<void>;
  stopCloudRun(taskId: string, runId?: string): Promise<boolean>;
  disconnectFromTask(taskId: string): Promise<void>;
  archive(taskId: string): Promise<void>;
  clearViewedState(taskId: string): void;
  logError(message: string, error: unknown): void;
  cache: ArchiveCacheWriter;
}

export interface ArchiveTaskOptions {
  skipNavigate?: boolean;
}

export async function archiveTask(
  taskId: string,
  deps: ArchiveOrchestrationDeps,
  options?: ArchiveTaskOptions,
): Promise<void> {
  if (!options?.skipNavigate) {
    deps.navigateAwayFromTaskIfActive(taskId);
  }

  const commandCenterSnapshot = deps.snapshotCommandCenter(taskId);
  deps.removeFromCommandCenter(taskId);

  const optimisticArchived = buildOptimisticArchivedTask(taskId, null);
  deps.cache.setArchivedTaskIds((old) => appendArchivedTaskId(old, taskId));
  deps.cache.setArchiveList((old) =>
    appendOptimisticArchivedTask(old, optimisticArchived),
  );

  let wasPinned = false;
  let didUnpin = false;

  try {
    const cancelPathFilter = deps.cache.cancelPathFilter();
    await cancelPathFilter;
    const [workspace, pinnedTaskIds, stopped] = await Promise.all([
      deps.getWorkspace(taskId),
      deps.getPinnedTaskIds(),
      deps.stopCloudRun(taskId),
    ]);
    if (!stopped) {
      throw new Error("Couldn't stop the task. Try again in a moment.");
    }

    wasPinned = pinnedTaskIds.includes(taskId);
    await deps.unpin(taskId);
    didUnpin = true;

    deps.cache.setArchiveList((old) =>
      appendOptimisticArchivedTask(
        old,
        buildOptimisticArchivedTask(
          taskId,
          workspace,
          optimisticArchived.archivedAt,
        ),
      ),
    );

    if (
      workspace?.worktreePath &&
      deps.getFocusedWorktreePath() === workspace.worktreePath
    ) {
      await deps.disableFocus();
    }

    await deps.disconnectFromTask(taskId);
    await deps.archive(taskId);
    deps.clearTerminalStates(taskId);
    deps.clearViewedState(taskId);
    deps.cache.invalidateArchiveList();
    deps.cache.invalidatePathFilter();
  } catch (error) {
    deps.logError("Failed to archive task", error);

    deps.cache.setArchivedTaskIds((old) => removeArchivedTaskId(old, taskId));
    deps.cache.setArchiveList((old) => removeArchivedTask(old, taskId));
    if (wasPinned && didUnpin) {
      await deps.togglePin(taskId);
    }
    if (commandCenterSnapshot.index !== -1) {
      deps.restoreCommandCenter(taskId, commandCenterSnapshot);
    }

    throw error;
  }
}

export interface ArchiveTasksResult {
  archived: number;
  failed: number;
}

export async function archiveTasks(
  taskIds: string[],
  deps: ArchiveOrchestrationDeps,
): Promise<ArchiveTasksResult> {
  if (taskIds.length === 0) return { archived: 0, failed: 0 };

  let archived = 0;
  let failed = 0;
  for (const id of taskIds) {
    try {
      await archiveTask(id, deps, { skipNavigate: true });
      archived++;
    } catch {
      failed++;
    }
  }
  return { archived, failed };
}

export function shouldNavigateAwayForBulkArchive(
  taskIds: string[],
  activeTaskId: string | null | undefined,
): boolean {
  if (taskIds.length === 0 || !activeTaskId) return false;
  return new Set(taskIds).has(activeTaskId);
}
