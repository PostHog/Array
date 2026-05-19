import { trpcClient } from "@renderer/trpc/client";
import type { Task } from "@shared/types";
import { logger } from "@utils/logger";
import { toast } from "@utils/toast";
import { useHandoffDialogStore } from "../stores/handoffDialogStore";
import { getSessionService } from "./service";

const log = logger.scope("local-handoff-service");

async function resolveRepoPathFromRemote(
  remoteUrl: string | undefined | null,
): Promise<string | null> {
  if (!remoteUrl) return null;
  const repo = await trpcClient.folders.getRepositoryByRemoteUrl.query({
    remoteUrl,
  });
  return repo?.path ?? null;
}

async function resolveRepoPathFromPicker(
  remoteUrl: string | null | undefined,
): Promise<string | null> {
  const selectedPath = await trpcClient.os.selectDirectory.query();
  if (!selectedPath) return null;

  await trpcClient.folders.addFolder.mutate({
    folderPath: selectedPath,
    remoteUrl: remoteUrl ?? undefined,
  });

  return selectedPath;
}

let serviceInstance: LocalHandoffService | null = null;

export function getLocalHandoffService(): LocalHandoffService {
  if (!serviceInstance) {
    serviceInstance = new LocalHandoffService();
  }
  return serviceInstance;
}

export class LocalHandoffService {
  public openConfirm(taskId: string, branchName: string | null): void {
    useHandoffDialogStore
      .getState()
      .openConfirm(taskId, "to-local", branchName);
  }

  public closeConfirm(): void {
    useHandoffDialogStore.getState().closeConfirm();
  }

  public cancelPendingFlow(): void {
    useHandoffDialogStore.getState().cancelPendingHandoff();
  }

  public hideDirtyTree(): void {
    useHandoffDialogStore.getState().hideDirtyTree();
  }

  public getPendingAfterCommit() {
    return useHandoffDialogStore.getState().pendingAfterCommit;
  }

  public async start(taskId: string, task: Task): Promise<void> {
    try {
      const targetPath =
        (await resolveRepoPathFromRemote(task.repository)) ??
        (await resolveRepoPathFromPicker(task.repository));

      if (!targetPath) return;

      const preflight = await getSessionService().preflightToLocal(
        taskId,
        targetPath,
      );

      if (preflight.canHandoff) {
        this.closeConfirm();
        await getSessionService().handoffToLocal(taskId, targetPath);
        return;
      }

      if (preflight.localTreeDirty && preflight.changedFiles) {
        useHandoffDialogStore
          .getState()
          .openDirtyTreeForPendingHandoff(preflight.changedFiles, {
            taskId,
            repoPath: targetPath,
            branchName: preflight.localGitState?.branch ?? null,
          });
        return;
      }

      toast.error(preflight.reason ?? "Cannot continue locally");
      this.closeConfirm();
    } catch (error) {
      log.error("Failed to hand off to local", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to continue locally: ${message}`);
      this.closeConfirm();
    }
  }

  public async resumePending(): Promise<void> {
    const pending = this.getPendingAfterCommit();
    if (!pending) return;

    useHandoffDialogStore.getState().clearPendingAfterCommit();

    try {
      await getSessionService().handoffToLocal(
        pending.taskId,
        pending.repoPath,
      );
    } catch (error) {
      log.error("Failed to resume handoff to local", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to continue locally: ${message}`);
    }
  }
}
