import { foldersApi } from "@features/folders/hooks/useFolders";
import { useTaskInputPrefillStore } from "@features/task-detail/stores/taskInputPrefillStore";
import { taskDetailQuery } from "@features/tasks/queries";
import { workspaceApi } from "@features/workspace/hooks/useWorkspace";
import { getTaskDirectory } from "@hooks/useRepositoryDirectory";
import * as nav from "@renderer/navigationBridge";
import type { Task } from "@shared/types";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { queryClient } from "@utils/queryClient";
import { getTaskRepository } from "@utils/repository";
import { useCallback } from "react";

const log = logger.scope("open-task");

/**
 * Opens a task: navigates to /code/tasks/$taskId and ensures a workspace
 * exists (auto-registering the folder if a local repo is available, or
 * creating a cloud workspace stub if the task is cloud-mode).
 *
 * Replaces the old `navigationStore.navigateToTask` action.
 */
export async function openTask(task: Task): Promise<void> {
  // Seed the detail cache so the route loader resolves from cache and never
  // fetches — critical for optimistic/local/cloud-pending tasks that the API
  // can't yet return, which would otherwise hang the route in its pending state.
  queryClient.setQueryData(taskDetailQuery(task.id).queryKey, task);
  nav.navigateToTaskDetail(task.id);
  track(ANALYTICS_EVENTS.TASK_VIEWED, { task_id: task.id });

  const repoKey = getTaskRepository(task) ?? undefined;
  const existingWorkspace = await workspaceApi.get(task.id);

  if (existingWorkspace?.folderId) {
    const folders = await foldersApi.getFolders();
    const folder = folders.find((f) => f.id === existingWorkspace.folderId);

    if (folder && folder.exists === false) {
      log.info("Folder path is stale, redirecting to folder settings", {
        folderId: folder.id,
        path: folder.path,
      });
      nav.navigateToFolderSettings(folder.id);
      return;
    }
    if (folder) return;
  }

  const directory = await getTaskDirectory(task.id, repoKey ?? undefined);

  if (directory) {
    try {
      await foldersApi.addFolder(directory);
      const workspaceMode =
        task.latest_run?.environment === "cloud" ? "cloud" : "local";
      await workspaceApi.create({
        taskId: task.id,
        mainRepoPath: directory,
        folderId: "",
        folderPath: directory,
        mode: workspaceMode,
      });
    } catch (error) {
      log.error("Failed to auto-register folder on task open:", error);
    }
  } else if (task.latest_run?.environment === "cloud") {
    await workspaceApi.create({
      taskId: task.id,
      mainRepoPath: "",
      folderId: "",
      folderPath: "",
      mode: "cloud",
    });
  }
}

/** React hook wrapper returning a stable `openTask` callback. */
export function useOpenTask(): (task: Task) => Promise<void> {
  return useCallback(openTask, []);
}

export interface TaskInputNavigationOptions {
  folderId?: string;
  initialPrompt?: string;
  initialCloudRepository?: string;
  initialModel?: string;
  initialMode?: string;
  reportAssociation?: { reportId: string; title: string };
}

/**
 * Navigate to the new-task screen, optionally with prefill (initial prompt,
 * report association, cloud repository, etc.). Replaces the old
 * `navigationStore.navigateToTaskInput` action.
 */
export function openTaskInput(
  folderIdOrOptions?: string | TaskInputNavigationOptions,
): void {
  const options =
    typeof folderIdOrOptions === "string"
      ? { folderId: folderIdOrOptions }
      : (folderIdOrOptions ?? {});

  const hasTransientState =
    !!options.initialPrompt ||
    !!options.initialCloudRepository ||
    !!options.initialModel ||
    !!options.initialMode ||
    !!options.reportAssociation;

  useTaskInputPrefillStore.setState({
    prefill: {
      folderId: options.folderId,
      initialPrompt: options.initialPrompt,
      initialCloudRepository: options.initialCloudRepository,
      initialModel: options.initialModel,
      initialMode: options.initialMode,
      reportAssociation: options.reportAssociation,
      requestId: hasTransientState
        ? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`)
        : undefined,
    },
  });
  nav.navigateToCode();
}

export function useOpenTaskInput(): typeof openTaskInput {
  return useCallback(openTaskInput, []);
}
