import type { FocusResult, FocusSession } from "@main/services/focus/schemas";
import { Saga, type SagaLogger } from "@posthog/shared";
import { trpcClient } from "@renderer/trpc";
import { logger } from "@utils/logger";

const log = logger.scope("focus-saga");

const sagaLogger: SagaLogger = {
  info: (message, data) => log.info(message, data),
  debug: (message, data) => log.debug(message, data),
  error: (message, data) => log.error(message, data),
  warn: (message, data) => log.warn(message, data),
};

type SessionContext = {
  type: "detached_head";
  branchName: string;
  isDetached: boolean;
};

async function notifyTaskSessions(
  taskId: string,
  context: SessionContext,
): Promise<void> {
  const sessions = await trpcClient.agent.listSessions.query({ taskId });
  for (const session of sessions) {
    trpcClient.agent.notifySessionContext
      .mutate({ sessionId: session.taskRunId, context })
      .catch((e) => log.warn("Failed to notify session:", e));
  }
}

async function notifyWorktreeTasks(
  worktreePath: string,
  context: SessionContext,
): Promise<void> {
  const tasks = await trpcClient.workspace.getWorktreeTasks.query({
    worktreePath,
  });
  for (const { taskId } of tasks) {
    await notifyTaskSessions(taskId, context);
  }
}

async function interruptLocalAgents(mainRepoPath: string): Promise<void> {
  const tasks = await trpcClient.workspace.getLocalTasks.query({
    mainRepoPath,
  });
  for (const { taskId } of tasks) {
    const sessions = await trpcClient.agent.listSessions.query({ taskId });
    for (const session of sessions) {
      trpcClient.agent.cancelPrompt
        .mutate({ sessionId: session.taskRunId, reason: "moving_to_worktree" })
        .catch((e) => log.warn("Failed to interrupt session:", e));
    }
  }
}

async function toRelativePath(
  absolutePath: string,
  mainRepoPath: string,
): Promise<string> {
  return trpcClient.focus.toRelativeWorktreePath.query({
    absolutePath,
    mainRepoPath,
  });
}

async function checkout(repoPath: string, branch: string): Promise<void> {
  const result = await trpcClient.focus.checkout.mutate({ repoPath, branch });
  if (!result.success) {
    const error = result.error ?? `Failed to checkout ${branch}`;
    if (/would be overwritten by checkout/i.test(error)) {
      throw new Error(
        `Can't switch to ${branch}: uncommitted changes would be overwritten. Commit or stash them first.`,
      );
    }
    throw new Error(error);
  }
}

async function detachWorktree(worktreePath: string): Promise<void> {
  const result = await trpcClient.focus.detachWorktree.mutate({
    worktreePath,
  });
  if (!result.success) {
    throw new Error(result.error ?? "Failed to detach worktree");
  }
}

async function reattachWorktree(
  worktreePath: string,
  branch: string,
): Promise<void> {
  const result = await trpcClient.focus.reattachWorktree.mutate({
    worktreePath,
    branch,
  });
  if (!result.success) {
    throw new Error(result.error ?? "Failed to reattach worktree");
  }
}

export interface FocusSagaInput {
  mainRepoPath: string;
  worktreePath: string;
  branch: string;
  currentSession: FocusSession | null;
}

export type FocusSagaResult = FocusResult & {
  session: FocusSession | null;
  wasSwap: boolean;
};

export type DisableSagaResult = FocusResult;

interface EnableInput {
  mainRepoPath: string;
  worktreePath: string;
  branch: string;
  originalBranch: string;
}

interface EnableOutput {
  mainStashRef: string | null;
  commitSha: string;
}

class FocusEnableSaga extends Saga<EnableInput, EnableOutput> {
  readonly sagaName = "FocusEnableSaga";

  constructor() {
    super(sagaLogger);
  }

  protected async execute(input: EnableInput): Promise<EnableOutput> {
    const { mainRepoPath, worktreePath, branch, originalBranch } = input;

    await this.readOnlyStep("interrupt_local_agents", () =>
      interruptLocalAgents(mainRepoPath),
    );

    const mainStashRef = await this.step({
      name: "stash_dirty_changes",
      execute: async () => {
        const isDirty = await trpcClient.focus.isDirty.query({
          repoPath: mainRepoPath,
        });
        if (!isDirty) return null;

        const timestamp = new Date().toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const result = await trpcClient.focus.stash.mutate({
          repoPath: mainRepoPath,
          message: `posthog-code: focusing ${branch} (${timestamp})`,
        });
        if (!result.success) throw new Error(result.error ?? "Failed to stash");
        return result.stashRef ?? null;
      },
      rollback: async (ref) => {
        if (ref)
          await trpcClient.focus.stashApply
            .mutate({ repoPath: mainRepoPath, stashRef: ref })
            .catch(() => {});
      },
    });

    await this.step({
      name: "detach_worktree",
      execute: async () => {
        await detachWorktree(worktreePath);
        await notifyWorktreeTasks(worktreePath, {
          type: "detached_head",
          branchName: branch,
          isDetached: true,
        });
      },
      rollback: async () => {
        await trpcClient.focus.reattachWorktree
          .mutate({ worktreePath, branch })
          .catch(() => {});
        await notifyWorktreeTasks(worktreePath, {
          type: "detached_head",
          branchName: branch,
          isDetached: false,
        });
      },
    });

    await this.step({
      name: "checkout_branch",
      execute: () => checkout(mainRepoPath, branch),
      rollback: async () => {
        await trpcClient.focus.checkout
          .mutate({ repoPath: mainRepoPath, branch: originalBranch })
          .catch(() => {});
      },
    });

    await this.step({
      name: "start_sync",
      execute: () =>
        trpcClient.focus.startSync.mutate({ mainRepoPath, worktreePath }),
      rollback: () => trpcClient.focus.stopSync.mutate().catch(() => {}),
    });

    const commitSha = await this.readOnlyStep("get_commit_sha", () =>
      trpcClient.focus.getCommitSha.query({ repoPath: mainRepoPath }),
    );

    await this.step({
      name: "save_session",
      execute: () =>
        trpcClient.focus.saveSession.mutate({
          mainRepoPath,
          worktreePath,
          branch,
          originalBranch,
          mainStashRef,
          commitSha,
        }),
      rollback: () =>
        trpcClient.focus.deleteSession.mutate({ mainRepoPath }).catch(() => {}),
    });

    await this.step({
      name: "start_watching_main_repo",
      execute: () =>
        trpcClient.focus.startWatchingMainRepo.mutate({ mainRepoPath }),
      rollback: () =>
        trpcClient.focus.stopWatchingMainRepo.mutate().catch(() => {}),
    });

    return { mainStashRef, commitSha };
  }
}

class FocusDisableSaga extends Saga<
  FocusSession,
  { stashPopWarning?: string }
> {
  readonly sagaName = "FocusDisableSaga";

  constructor() {
    super(sagaLogger);
  }

  protected async execute(
    input: FocusSession,
  ): Promise<{ stashPopWarning?: string }> {
    const { mainRepoPath, worktreePath, branch, originalBranch, mainStashRef } =
      input;

    await this.readOnlyStep("stop_watching_main_repo", () =>
      trpcClient.focus.stopWatchingMainRepo.mutate(),
    );

    await this.step({
      name: "stop_sync",
      execute: () => trpcClient.focus.stopSync.mutate(),
      rollback: () =>
        trpcClient.focus.startSync
          .mutate({ mainRepoPath, worktreePath })
          .catch(() => {}),
    });

    await this.readOnlyStep("clean_working_tree", () =>
      trpcClient.focus.cleanWorkingTree.mutate({ repoPath: mainRepoPath }),
    );

    await this.step({
      name: "checkout_original_branch",
      execute: () => checkout(mainRepoPath, originalBranch),
      rollback: async () => {
        await trpcClient.focus.checkout
          .mutate({ repoPath: mainRepoPath, branch })
          .catch(() => {});
      },
    });

    await this.step({
      name: "reattach_worktree",
      execute: async () => {
        await reattachWorktree(worktreePath, branch);
        await notifyWorktreeTasks(worktreePath, {
          type: "detached_head",
          branchName: branch,
          isDetached: false,
        });
      },
      rollback: async () => {
        await trpcClient.focus.detachWorktree
          .mutate({ worktreePath })
          .catch(() => {});
      },
    });

    let stashPopWarning: string | undefined;
    if (mainStashRef) {
      stashPopWarning = await this.readOnlyStep("restore_stash", async () => {
        const result = await trpcClient.focus.stashApply.mutate({
          repoPath: mainRepoPath,
          stashRef: mainStashRef,
        });
        if (!result.success) {
          const warning = `Stash apply failed: ${result.error}. Run 'git stash apply ${mainStashRef}' manually.`;
          log.warn(warning);
          return warning;
        }
        return undefined;
      });
    }

    await this.readOnlyStep("delete_session", () =>
      trpcClient.focus.deleteSession.mutate({ mainRepoPath }),
    );

    return { stashPopWarning };
  }
}

interface FocusOutput {
  session: FocusSession;
  wasSwap: boolean;
}

class FocusSaga extends Saga<FocusSagaInput, FocusOutput> {
  readonly sagaName = "FocusSaga";

  constructor() {
    super(sagaLogger);
  }

  protected async execute(input: FocusSagaInput): Promise<FocusOutput> {
    const { mainRepoPath, worktreePath, branch, currentSession } = input;

    const wasSwap = await this.readOnlyStep("check_swap", async () => {
      if (!currentSession || currentSession.mainRepoPath !== mainRepoPath)
        return false;
      if (currentSession.worktreePath === worktreePath) {
        throw new AlreadyFocusedError(currentSession);
      }
      return true;
    });

    if (wasSwap) {
      await this.step({
        name: "unfocus_current",
        execute: async () => {
          if (!currentSession) throw new Error("No current session to unfocus");
          const result = await new FocusDisableSaga().run(currentSession);
          if (!result.success)
            throw new Error(`Failed to unfocus: ${result.error}`);
        },
        rollback: async () => {},
      });
    }

    const currentBranch = await this.readOnlyStep(
      "get_current_branch",
      async () => {
        const branch = await trpcClient.git.getCurrentBranch.query({
          directoryPath: mainRepoPath,
        });
        if (!branch) throw new Error("Could not determine current branch");
        return branch;
      },
    );

    await this.readOnlyStep("validate", async () => {
      const error = await trpcClient.focus.validateFocusOperation.query({
        mainRepoPath,
        currentBranch,
        targetBranch: branch,
      });
      if (error) throw new Error(error);
    });

    const enableResult = await this.step({
      name: "enable_focus",
      execute: async () => {
        const result = await new FocusEnableSaga().run({
          mainRepoPath,
          worktreePath,
          branch,
          originalBranch: currentBranch,
        });
        if (!result.success) throw new Error(result.error);
        return result.data;
      },
      rollback: async () => {},
    });

    return {
      session: {
        mainRepoPath,
        worktreePath,
        branch,
        originalBranch: currentBranch,
        mainStashRef: enableResult.mainStashRef,
        commitSha: enableResult.commitSha,
      },
      wasSwap,
    };
  }
}

class AlreadyFocusedError extends Error {
  constructor(public session: FocusSession) {
    super("Already focused on this worktree");
  }
}

interface RestoreInput {
  mainRepoPath: string;
}

class FocusRestoreSaga extends Saga<RestoreInput, FocusSession | null> {
  readonly sagaName = "FocusRestoreSaga";

  constructor() {
    super(sagaLogger);
  }

  protected async execute(input: RestoreInput): Promise<FocusSession | null> {
    const { mainRepoPath } = input;

    const session = await this.readOnlyStep("get_session", () =>
      trpcClient.focus.getSession.query({ mainRepoPath }),
    );

    if (!session) return null;

    const { worktreePath, branch, originalBranch } = session;

    const relWorktreePath = await toRelativePath(worktreePath, mainRepoPath);

    const validatedSession = await this.readOnlyStep(
      "validate_state",
      async (): Promise<FocusSession | null> => {
        if (originalBranch === branch) {
          log.error(
            `Corrupt session: originalBranch === branch (${originalBranch})`,
          );
          await trpcClient.focus.deleteSession.mutate({ mainRepoPath });
          return null;
        }

        const exists = await trpcClient.focus.worktreeExistsAtPath.query({
          relativePath: relWorktreePath,
        });
        if (!exists) {
          log.warn(
            `Worktree not found at ${relWorktreePath}. Clearing session.`,
          );
          await trpcClient.focus.deleteSession.mutate({ mainRepoPath });
          return null;
        }

        const currentBranch = await trpcClient.git.getCurrentBranch.query({
          directoryPath: mainRepoPath,
        });
        if (!currentBranch) {
          log.warn("Main repo is in detached HEAD state. Clearing session.");
          await trpcClient.focus.deleteSession.mutate({ mainRepoPath });
          return null;
        }

        if (currentBranch !== branch) {
          const currentCommitSha = await trpcClient.focus.getCommitSha.query({
            repoPath: mainRepoPath,
          });

          if (currentCommitSha === session.commitSha) {
            log.info(
              `Branch was renamed while app was closed: ${branch} -> ${currentBranch}. Updating session.`,
            );
            const updatedSession: FocusSession = {
              ...session,
              branch: currentBranch,
            };
            await trpcClient.focus.saveSession.mutate(updatedSession);
            return updatedSession;
          } else {
            log.warn(
              `Branch changed and commit differs. Likely checkout to different branch. Clearing session.`,
            );
            await trpcClient.focus.deleteSession.mutate({ mainRepoPath });
            return null;
          }
        }

        return session;
      },
    );

    if (!validatedSession) return null;

    await this.readOnlyStep("start_sync", () =>
      trpcClient.focus.startSync.mutate({
        mainRepoPath,
        worktreePath: validatedSession.worktreePath,
      }),
    );

    await this.readOnlyStep("start_watching_main_repo", () =>
      trpcClient.focus.startWatchingMainRepo.mutate({ mainRepoPath }),
    );

    log.info(`Restored focus session for branch ${validatedSession.branch}`);

    return validatedSession;
  }
}

export async function runFocusSaga(
  input: FocusSagaInput,
): Promise<FocusSagaResult> {
  const saga = new FocusSaga();
  const result = await saga.run(input);

  if (!result.success) {
    if (
      result.error === "Already focused on this worktree" &&
      input.currentSession
    ) {
      return { success: true, session: input.currentSession, wasSwap: false };
    }
    return {
      success: false,
      error: result.error,
      session: null,
      wasSwap: false,
    };
  }

  return {
    success: true,
    session: result.data.session,
    wasSwap: result.data.wasSwap,
  };
}

export async function runDisableFocusSaga(
  input: FocusSession,
): Promise<DisableSagaResult> {
  const saga = new FocusDisableSaga();
  const result = await saga.run(input);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true, stashPopWarning: result.data.stashPopWarning };
}

export async function runRestoreSaga(
  mainRepoPath: string,
): Promise<FocusSession | null> {
  const saga = new FocusRestoreSaga();
  const result = await saga.run({ mainRepoPath });

  if (!result.success) {
    if (result.error === "Invalid focus state") return null;
    log.error(`Failed to restore focus state: ${result.error}`);
    return null;
  }

  return result.data;
}
