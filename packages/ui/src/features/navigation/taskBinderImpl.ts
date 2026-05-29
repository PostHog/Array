import { resolveService } from "@posthog/di/container";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import { expandTildePath, getTaskRepository } from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import type {
  EnsureWorkspaceResult,
  NavigationTaskBinder,
} from "@posthog/ui/features/navigation/taskBinder";
import { logger } from "@posthog/ui/shell/logger";

const log = logger.scope("navigation-store");

function hostClient(): HostTrpcClient {
  return resolveService<HostTrpcClient>(HOST_TRPC_CLIENT);
}

async function getTaskDirectory(
  taskId: string,
  repoKey?: string,
): Promise<string | null> {
  const workspaces = await hostClient().workspace.getAll.query();
  const workspace = workspaces?.[taskId] ?? null;
  if (workspace?.folderPath) {
    return expandTildePath(workspace.folderPath);
  }

  if (repoKey) {
    const repo = await hostClient().folders.getRepositoryByRemoteUrl.query({
      remoteUrl: repoKey,
    });
    if (repo) {
      return expandTildePath(repo.path);
    }
  }

  return null;
}

export const navigationTaskBinder: NavigationTaskBinder = {
  async ensureWorkspaceForTask(
    task: Task,
  ): Promise<EnsureWorkspaceResult | undefined> {
    const repoKey = getTaskRepository(task) ?? undefined;

    const workspaces = await hostClient().workspace.getAll.query();
    const existingWorkspace = workspaces?.[task.id] ?? null;
    if (existingWorkspace?.folderId) {
      const folders = await hostClient().folders.getFolders.query();
      const folder = folders.find((f) => f.id === existingWorkspace.folderId);

      if (folder && folder.exists === false) {
        log.info("Folder path is stale, redirecting to folder settings", {
          folderId: folder.id,
          path: folder.path,
        });
        return { staleFolderId: folder.id };
      }

      if (folder) {
        return undefined;
      }
    }

    const directory = await getTaskDirectory(task.id, repoKey ?? undefined);

    if (directory) {
      try {
        await hostClient().folders.addFolder.mutate({ folderPath: directory });

        const workspaceMode =
          task.latest_run?.environment === "cloud" ? "cloud" : "local";

        await hostClient().workspace.create.mutate({
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
      await hostClient().workspace.create.mutate({
        taskId: task.id,
        mainRepoPath: "",
        folderId: "",
        folderPath: "",
        mode: "cloud",
      });
    }

    return undefined;
  },
};
