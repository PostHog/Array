import fs from "node:fs/promises";
import path from "node:path";
import { createGitClient } from "@posthog/git/client";
import { isGitRepository } from "@posthog/git/queries";
import {
  CaptureCheckpointSaga,
  deleteCheckpoint,
  RevertCheckpointSaga,
} from "@posthog/git/sagas/checkpoint";
import { forceRemove } from "@posthog/git/utils";
import { type WorktreeInfo, WorktreeManager } from "@posthog/git/worktree";
import { inject, injectable } from "inversify";
import type {
  Archive,
  ArchiveRepository,
} from "../../db/repositories/archive-repository";
import type { RepositoryRepository } from "../../db/repositories/repository-repository";
import type {
  SuspensionReason,
  SuspensionRepository,
} from "../../db/repositories/suspension-repository.js";
import type {
  Workspace,
  WorkspaceRepository,
} from "../../db/repositories/workspace-repository";
import type { WorktreeRepository } from "../../db/repositories/worktree-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type { AgentService } from "../agent/service";
import type { FileWatcherService } from "../file-watcher/service";
import type { ProcessTrackingService } from "../process-tracking/service";
import { getWorktreeLocation } from "../settingsStore";
import type { ArchivedTask, ArchiveTaskInput } from "./schemas";

const log = logger.scope("archive");

type RollbackFn = () => Promise<void>;

@injectable()
export class ArchiveService {
  constructor(
    @inject(MAIN_TOKENS.AgentService)
    private readonly agentService: AgentService,
    @inject(MAIN_TOKENS.ProcessTrackingService)
    private readonly processTracking: ProcessTrackingService,
    @inject(MAIN_TOKENS.FileWatcherService)
    private readonly fileWatcher: FileWatcherService,
    @inject(MAIN_TOKENS.RepositoryRepository)
    private readonly repositoryRepo: RepositoryRepository,
    @inject(MAIN_TOKENS.WorkspaceRepository)
    private readonly workspaceRepo: WorkspaceRepository,
    @inject(MAIN_TOKENS.WorktreeRepository)
    private readonly worktreeRepo: WorktreeRepository,
    @inject(MAIN_TOKENS.ArchiveRepository)
    private readonly archiveRepo: ArchiveRepository,
    @inject(MAIN_TOKENS.SuspensionRepository)
    private readonly suspensionRepo: SuspensionRepository,
  ) {}

  async archiveTask(input: ArchiveTaskInput): Promise<ArchivedTask> {
    log.info(`Archiving task ${input.taskId}`);

    const rollbacks: RollbackFn[] = [];
    const runWithRollback = async (
      execute: () => Promise<void>,
      rollback: RollbackFn,
    ) => {
      await execute();
      rollbacks.push(rollback);
    };

    try {
      const result = await this.executeArchive(input, runWithRollback);
      log.info(`Task ${input.taskId} archived successfully`);
      return result;
    } catch (error) {
      for (const rollback of rollbacks.reverse()) {
        try {
          await rollback();
        } catch (rollbackError) {
          log.error("Rollback failed:", rollbackError);
        }
      }
      throw error;
    }
  }

  private async executeArchive(
    input: ArchiveTaskInput,
    step: (execute: () => Promise<void>, rollback: RollbackFn) => Promise<void>,
  ): Promise<ArchivedTask> {
    const { taskId } = input;

    const workspace = this.workspaceRepo.findByTaskId(taskId);
    if (!workspace) {
      return {
        taskId,
        archivedAt: new Date().toISOString(),
        folderId: "",
        mode: "cloud",
        worktreeName: null,
        branchName: null,
        checkpointId: null,
      };
    }

    const existingArchive = this.archiveRepo.findByWorkspaceId(workspace.id);
    if (existingArchive) {
      throw new Error(`Task ${taskId} is already archived`);
    }

    const suspension = this.suspensionRepo.findByWorkspaceId(workspace.id);
    const worktree = this.worktreeRepo.findByWorkspaceId(workspace.id);

    if (suspension) {
      const archivedTask: ArchivedTask = {
        taskId,
        archivedAt: new Date().toISOString(),
        folderId: workspace.repositoryId ?? "",
        mode: workspace.mode,
        worktreeName: worktree?.name ?? null,
        branchName: suspension.branchName,
        checkpointId: suspension.checkpointId,
      };

      await step(
        async () => {
          this.archiveRepo.create({
            workspaceId: workspace.id,
            branchName: archivedTask.branchName,
            checkpointId: archivedTask.checkpointId,
          });
        },
        async () => {
          this.archiveRepo.deleteByWorkspaceId(workspace.id);
        },
      );

      await step(
        async () => {
          this.suspensionRepo.deleteByWorkspaceId(workspace.id);
        },
        async () => {
          this.suspensionRepo.create({
            workspaceId: workspace.id,
            branchName: suspension.branchName,
            checkpointId: suspension.checkpointId,
            reason: suspension.reason as SuspensionReason,
          });
        },
      );

      return archivedTask;
    }

    const archivedTask: ArchivedTask = {
      taskId,
      archivedAt: new Date().toISOString(),
      folderId: workspace.repositoryId ?? "",
      mode: workspace.mode,
      worktreeName: worktree?.name ?? null,
      branchName: null,
      checkpointId:
        workspace.mode === "worktree" && worktree
          ? `worktree-${worktree.name}`
          : null,
    };

    if (workspace.repositoryId) {
      const repo = this.repositoryRepo.findById(workspace.repositoryId);
      if (!repo) {
        throw new Error(`Repository not found for task ${taskId}`);
      }
      const folderPath = repo.path;

      if (workspace.mode === "worktree" && worktree) {
        const worktreePath = worktree.path;
        const worktreeIsValid = await isGitRepository(worktreePath).catch(
          (error) => {
            log.warn(
              `Failed to check worktree at ${worktreePath}; treating as invalid`,
              { error },
            );
            return false;
          },
        );

        if (!worktreeIsValid) {
          log.warn(
            `Worktree at ${worktreePath} is missing or not a git repository; skipping checkpoint capture`,
          );
          archivedTask.checkpointId = null;
        } else {
          const actualBranch = await this.getCurrentBranchName(worktreePath);
          if (actualBranch && actualBranch !== "HEAD") {
            archivedTask.branchName = actualBranch;
          }

          await step(
            async () => {
              if (!archivedTask.checkpointId) {
                throw new Error("checkpointId must be set for worktree mode");
              }
              await this.captureWorktreeCheckpoint(
                folderPath,
                worktreePath,
                archivedTask.checkpointId,
              );
            },
            async () => {
              if (archivedTask.checkpointId) {
                const git = createGitClient(folderPath);
                await deleteCheckpoint(git, archivedTask.checkpointId);
              }
            },
          );
        }

        await step(
          async () => {
            await this.agentService.cancelSessionsByTaskId(taskId);
            this.processTracking.killByTaskId(taskId);
            await this.fileWatcher.stopWatching(worktreePath);
          },
          async () => {},
        );

        await step(
          async () => {
            const manager = new WorktreeManager({
              mainRepoPath: folderPath,
              worktreeBasePath: getWorktreeLocation(),
            });
            await manager.deleteWorktree(worktreePath);
            const parentDir = path.dirname(worktreePath);
            await forceRemove(parentDir);
          },
          async () => {},
        );
      }
    }

    if (workspace.mode !== "worktree") {
      await step(
        async () => {
          await this.agentService.cancelSessionsByTaskId(taskId);
          this.processTracking.killByTaskId(taskId);
        },
        async () => {},
      );
    }

    await step(
      async () => {
        this.archiveRepo.create({
          workspaceId: workspace.id,
          branchName: archivedTask.branchName,
          checkpointId: archivedTask.checkpointId,
        });
      },
      async () => {
        this.archiveRepo.deleteByWorkspaceId(workspace.id);
      },
    );

    return archivedTask;
  }

  async unarchiveTask(
    taskId: string,
    recreateBranch?: boolean,
  ): Promise<{ taskId: string; worktreeName: string | null }> {
    log.info(
      `Unarchiving task ${taskId}${recreateBranch ? " (recreate branch)" : ""}`,
    );

    const rollbacks: RollbackFn[] = [];
    const runWithRollback = async (
      execute: () => Promise<void>,
      rollback: RollbackFn,
    ) => {
      await execute();
      rollbacks.push(rollback);
    };

    try {
      const result = await this.executeUnarchive(
        taskId,
        recreateBranch,
        runWithRollback,
      );
      log.info(`Task ${taskId} unarchived successfully`);
      return result;
    } catch (error) {
      for (const rollback of rollbacks.reverse()) {
        try {
          await rollback();
        } catch (rollbackError) {
          log.error("Rollback failed:", rollbackError);
        }
      }
      throw error;
    }
  }

  private async executeUnarchive(
    taskId: string,
    recreateBranch: boolean | undefined,
    step: (execute: () => Promise<void>, rollback: RollbackFn) => Promise<void>,
  ): Promise<{ taskId: string; worktreeName: string | null }> {
    const workspace = this.workspaceRepo.findByTaskId(taskId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${taskId}`);
    }

    const archive = this.archiveRepo.findByWorkspaceId(workspace.id);
    if (!archive) {
      throw new Error(`Archived task not found: ${taskId}`);
    }

    const worktree = this.worktreeRepo.findByWorkspaceId(workspace.id);
    let restoredWorktreeName: string | null = worktree?.name ?? null;

    if (workspace.repositoryId) {
      const repo = this.repositoryRepo.findById(workspace.repositoryId);
      if (!repo) {
        throw new Error(`Repository not found for task ${taskId}`);
      }
      const folderPath = repo.path;

      const shouldRestoreWorktree =
        workspace.mode === "worktree" && archive.checkpointId;

      if (shouldRestoreWorktree) {
        await step(
          async () => {
            restoredWorktreeName = await this.restoreWorktreeFromCheckpoint(
              folderPath,
              workspace,
              archive,
              recreateBranch,
            );
          },
          async () => {
            if (restoredWorktreeName) {
              const manager = new WorktreeManager({
                mainRepoPath: folderPath,
                worktreeBasePath: getWorktreeLocation(),
              });
              const worktreePath = await this.deriveWorktreePath(
                folderPath,
                restoredWorktreeName,
              );
              await manager.deleteWorktree(worktreePath);
              const parentDir = path.dirname(worktreePath);
              await forceRemove(parentDir);
            }
          },
        );

        await step(
          async () => {
            if (!restoredWorktreeName) {
              throw new Error("Failed to restore worktree");
            }
            const worktreePath = await this.deriveWorktreePath(
              folderPath,
              restoredWorktreeName,
            );
            this.worktreeRepo.create({
              workspaceId: workspace.id,
              name: restoredWorktreeName,
              path: worktreePath,
            });
          },
          async () => {
            this.worktreeRepo.deleteByWorkspaceId(workspace.id);
          },
        );
      }
    }

    await step(
      async () => {
        this.archiveRepo.deleteByWorkspaceId(workspace.id);
      },
      async () => {
        this.archiveRepo.create({
          workspaceId: workspace.id,
          branchName: archive.branchName,
          checkpointId: archive.checkpointId,
        });
      },
    );

    return { taskId, worktreeName: restoredWorktreeName };
  }

  getArchivedTasks(): ArchivedTask[] {
    const archives = this.archiveRepo.findAll();
    return archives.map((archive) => {
      const workspace = this.workspaceRepo.findById(
        archive.workspaceId,
      ) as Workspace;
      const worktree = this.worktreeRepo.findByWorkspaceId(workspace.id);
      return this.toArchivedTask(workspace, archive, worktree?.name ?? null);
    });
  }

  getArchivedTaskIds(): string[] {
    const archives = this.archiveRepo.findAll();
    return archives
      .map((archive) => {
        const workspace = this.workspaceRepo.findById(archive.workspaceId);
        return workspace?.taskId;
      })
      .filter((id): id is string => id !== undefined);
  }

  isArchived(taskId: string): boolean {
    const workspace = this.workspaceRepo.findByTaskId(taskId);
    if (!workspace) return false;
    return this.archiveRepo.findByWorkspaceId(workspace.id) !== null;
  }

  async deleteArchivedTask(taskId: string): Promise<void> {
    log.info(`Deleting archived task ${taskId}`);

    const workspace = this.workspaceRepo.findByTaskId(taskId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${taskId}`);
    }

    const archive = this.archiveRepo.findByWorkspaceId(workspace.id);
    if (!archive) {
      throw new Error(`Archived task ${taskId} not found`);
    }

    if (archive.checkpointId && workspace.repositoryId) {
      const repo = this.repositoryRepo.findById(workspace.repositoryId);
      if (repo) {
        try {
          const git = createGitClient(repo.path);
          await deleteCheckpoint(git, archive.checkpointId);
        } catch (error) {
          log.warn(`Failed to delete checkpoint ${archive.checkpointId}`, {
            error,
          });
        }
      }
    }

    this.archiveRepo.deleteByWorkspaceId(workspace.id);
    this.workspaceRepo.deleteByTaskId(taskId);
    log.info(`Deleted archived task ${taskId}`);
  }

  private toArchivedTask(
    workspace: Workspace,
    archive: Archive,
    worktreeName: string | null,
  ): ArchivedTask {
    return {
      taskId: workspace.taskId,
      archivedAt: archive.archivedAt,
      folderId: workspace.repositoryId ?? "",
      mode: workspace.mode,
      worktreeName,
      branchName: archive.branchName,
      checkpointId: archive.checkpointId,
    };
  }

  private async deriveWorktreePath(
    folderPath: string,
    worktreeName: string,
  ): Promise<string> {
    const worktreeBasePath = getWorktreeLocation();
    const repoName = path.basename(folderPath);

    const newFormatPath = path.join(worktreeBasePath, worktreeName, repoName);
    const legacyFormatPath = path.join(
      worktreeBasePath,
      repoName,
      worktreeName,
    );

    try {
      await fs.access(newFormatPath);
      return newFormatPath;
    } catch {}

    try {
      await fs.access(legacyFormatPath);
      return legacyFormatPath;
    } catch {}

    return newFormatPath;
  }

  private async getCurrentBranchName(worktreePath: string): Promise<string> {
    const git = createGitClient(worktreePath);
    try {
      const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
      return branch.trim();
    } catch {
      return "";
    }
  }

  private async captureWorktreeCheckpoint(
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

  private async restoreWorktreeFromCheckpoint(
    folderPath: string,
    workspace: Workspace,
    archive: Archive,
    recreateBranch?: boolean,
  ): Promise<string> {
    const worktree = this.worktreeRepo.findByWorkspaceId(workspace.id);
    const manager = new WorktreeManager({
      mainRepoPath: folderPath,
      worktreeBasePath: getWorktreeLocation(),
    });
    const preferredName = worktree?.name ?? undefined;

    let newWorktree: WorktreeInfo;
    if (archive.branchName && !recreateBranch) {
      newWorktree = await manager.createWorktreeForExistingBranch(
        archive.branchName,
        preferredName,
      );
    } else {
      newWorktree = await manager.createDetachedWorktreeAtCommit(
        "HEAD",
        preferredName,
      );
    }

    if (!archive.checkpointId) {
      throw new Error("checkpointId is required for restoring worktree");
    }

    const revertSaga = new RevertCheckpointSaga();
    const result = await revertSaga.run({
      baseDir: newWorktree.worktreePath,
      checkpointId: archive.checkpointId,
    });

    if (!result.success) {
      throw new Error(
        `Worktree restored but failed to apply checkpoint: ${result.error}`,
      );
    }

    if (recreateBranch && archive.branchName) {
      const git = createGitClient(newWorktree.worktreePath);
      await git.checkoutLocalBranch(archive.branchName);
    }

    if (worktree) {
      this.worktreeRepo.deleteByWorkspaceId(workspace.id);
    }

    return newWorktree.worktreeName;
  }
}
