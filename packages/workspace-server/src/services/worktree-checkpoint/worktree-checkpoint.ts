import { createGitClient } from "@posthog/git/client";
import {
  CaptureCheckpointSaga,
  deleteCheckpoint,
  RevertCheckpointSaga,
} from "@posthog/git/sagas/checkpoint";
import { type WorktreeInfo, WorktreeManager } from "@posthog/git/worktree";
import type { SagaLogger } from "@posthog/shared";

export interface RestoreWorktreeFromCheckpointParams {
  mainRepoPath: string;
  worktreeBasePath: string;
  /** Reuse this worktree name if provided. */
  preferredName: string | undefined;
  branchName: string | null;
  checkpointId: string;
  recreateBranch?: boolean;
  restoreBranch?: boolean;
  logger?: SagaLogger;
  onOutput?: (data: string) => void;
}

/**
 * Recreate a worktree (for an existing branch, or detached at HEAD) and revert
 * it to a captured checkpoint, optionally recreating the branch. Shared by
 * archive (unarchive) + suspension (restore); callers own their repo bookkeeping.
 */
export async function restoreWorktreeFromCheckpoint(
  params: RestoreWorktreeFromCheckpointParams,
): Promise<WorktreeInfo> {
  const manager = new WorktreeManager({
    mainRepoPath: params.mainRepoPath,
    worktreeBasePath: params.worktreeBasePath,
    logger: params.logger,
  });

  let newWorktree: WorktreeInfo;
  if (params.branchName && !params.recreateBranch) {
    newWorktree = params.onOutput
      ? await manager.createWorktreeForExistingBranch(
          params.branchName,
          params.preferredName,
          { onOutput: params.onOutput },
        )
      : await manager.createWorktreeForExistingBranch(
          params.branchName,
          params.preferredName,
        );
  } else {
    newWorktree = params.onOutput
      ? await manager.createDetachedWorktreeAtCommit(
          "HEAD",
          params.preferredName,
          { onOutput: params.onOutput },
        )
      : await manager.createDetachedWorktreeAtCommit(
          "HEAD",
          params.preferredName,
        );
  }

  try {
    const revertSaga = new RevertCheckpointSaga();
    const result = await revertSaga.run({
      baseDir: newWorktree.worktreePath,
      checkpointId: params.checkpointId,
      restoreBranch: params.restoreBranch,
    });
    if (!result.success) {
      throw new Error(
        `Worktree restored but failed to apply checkpoint: ${result.error}`,
      );
    }

    if (params.recreateBranch && params.branchName) {
      const git = createGitClient(newWorktree.worktreePath);
      await git.checkoutLocalBranch(params.branchName);
    }
  } catch (error) {
    await manager
      .deleteWorktree(newWorktree.worktreePath)
      .catch((cleanupError) => {
        params.logger?.warn(
          "Failed to clean up worktree after restore failure",
          {
            worktreePath: newWorktree.worktreePath,
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          },
        );
      });
    throw error;
  }

  return newWorktree;
}

/**
 * Capture a checkpoint of a worktree's current state. Clears any stale
 * checkpoint of the same id first, then runs CaptureCheckpointSaga. Shared by
 * archive + suspension, which capture identically.
 */
export async function captureWorktreeCheckpoint(
  folderPath: string,
  worktreePath: string,
  checkpointId: string,
): Promise<void> {
  const git = createGitClient(folderPath);
  try {
    await deleteCheckpoint(git, checkpointId);
  } catch {}

  const saga = new CaptureCheckpointSaga();
  const result = await saga.run({ baseDir: worktreePath, checkpointId });
  if (!result.success) {
    throw new Error(`Failed to capture checkpoint: ${result.error}`);
  }
}

export async function deleteWorktreeCheckpoint(
  folderPath: string,
  checkpointId: string,
): Promise<void> {
  await deleteCheckpoint(createGitClient(folderPath), checkpointId);
}
