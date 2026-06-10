import path from "node:path";
import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import { createGitClient } from "@posthog/git/client";
import { isGitRepository } from "@posthog/git/queries";
import { deleteCheckpoint } from "@posthog/git/sagas/checkpoint";
import { forceRemove } from "@posthog/git/utils";
import { WorktreeManager } from "@posthog/git/worktree";
import {
  type IWorkspaceSettings,
  WORKSPACE_SETTINGS_SERVICE,
} from "@posthog/platform/workspace-settings";
import { inject, injectable } from "inversify";
import {
  ARCHIVE_REPOSITORY,
  REPOSITORY_REPOSITORY,
  SUSPENSION_REPOSITORY,
  WORKSPACE_REPOSITORY,
  WORKTREE_REPOSITORY,
} from "../../db/identifiers";
import type {
  Archive,
  ArchiveRepository,
} from "../../db/repositories/archive-repository";
import type { RepositoryRepository } from "../../db/repositories/repository-repository";
import type {
  SuspensionReason,
  SuspensionRepository,
} from "../../db/repositories/suspension-repository";
import type {
  Workspace,
  WorkspaceRepository,
} from "../../db/repositories/workspace-repository";
import type { WorktreeRepository } from "../../db/repositories/worktree-repository";
import { PROCESS_TRACKING_SERVICE } from "../process-tracking/identifiers";
import type { ProcessTrackingService } from "../process-tracking/process-tracking";
import {
  captureWorktreeCheckpoint,
  restoreWorktreeFromCheckpoint,
} from "../worktree-checkpoint/worktree-checkpoint";
import { deriveWorktreePath as deriveWorktreePathFromBase } from "../worktree-path/worktree-path";
import { getCurrentBranchName } from "../worktree-query/worktree-query";
import { ARCHIVE_FILE_WATCHER, ARCHIVE_SESSION_CANCELLER } from "./identifiers";
import type { ArchiveFileWatcher, SessionCanceller } from "./ports";
import type { ArchivedTask, ArchiveTaskInput } from "./schemas";

type RollbackFn = () => Promise<void>;

@injectable()
export class ArchiveService {
  constructor(
    @inject(ARCHIVE_SESSION_CANCELLER)
    private readonly sessionCanceller: SessionCanceller,
    @inject(PROCESS_TRACKING_SERVICE)
    private readonly processTracking: ProcessTrackingService,
    @inject(ARCHIVE_FILE_WATCHER)
    private readonly fileWatcher: ArchiveFileWatcher,
    @inject(REPOSITORY_REPOSITORY)
    private readonly repositoryRepo: RepositoryRepository,
    @inject(WORKSPACE_REPOSITORY)
    private readonly workspaceRepo: WorkspaceRepository,
    @inject(WORKTREE_REPOSITORY)
    private readonly worktreeRepo: WorktreeRepository,
    @inject(ARCHIVE_REPOSITORY)
    private readonly archiveRepo: ArchiveRepository,
    @inject(SUSPENSION_REPOSITORY)
    private readonly suspensionRepo: SuspensionRepository,
    @inject(WORKSPACE_SETTINGS_SERVICE)
    private readonly workspaceSettings: IWorkspaceSettings,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("archive");
  }

  private readonly log: ScopedLogger;

  async archiveTask(input: ArchiveTaskInput): Promise<ArchivedTask> {
    this.log.info(`Archiving task ${input.taskId}`);

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
      this.log.info(`Task ${input.taskId} archived successfully`);
      return result;
    } catch (error) {
      for (const rollback of rollbacks.reverse()) {
        try {
          await rollback();
        } catch (rollbackError) {
          this.log.error("Rollback failed:", rollbackError);
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
            this.log.warn(
              `Failed to check worktree at ${worktreePath}; treating as invalid`,
              { error },
            );
            return false;
          },
        );

        if (!worktreeIsValid) {
          this.log.warn(
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
            await this.sessionCanceller.cancelSessionsByTaskId(taskId);
            this.processTracking.killByTaskId(taskId);
            await this.fileWatcher.stopWatching(worktreePath);
          },
          async () => {},
        );

        await step(
          async () => {
            const manager = new WorktreeManager({
              mainRepoPath: folderPath,
              worktreeBasePath: this.workspaceSettings.getWorktreeLocation(),
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
          await this.sessionCanceller.cancelSessionsByTaskId(taskId);
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
    this.log.info(
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
      this.log.info(`Task ${taskId} unarchived successfully`);
      return result;
    } catch (error) {
      for (const rollback of rollbacks.reverse()) {
        try {
          await rollback();
        } catch (rollbackError) {
          this.log.error("Rollback failed:", rollbackError);
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
                worktreeBasePath: this.workspaceSettings.getWorktreeLocation(),
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
    this.log.info(`Deleting archived task ${taskId}`);

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
          this.log.warn(`Failed to delete checkpoint ${archive.checkpointId}`, {
            error,
          });
        }
      }
    }

    this.archiveRepo.deleteByWorkspaceId(workspace.id);
    this.workspaceRepo.deleteByTaskId(taskId);
    this.log.info(`Deleted archived task ${taskId}`);
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

  private deriveWorktreePath(folderPath: string, worktreeName: string): string {
    return deriveWorktreePathFromBase(
      this.workspaceSettings.getWorktreeLocation(),
      folderPath,
      worktreeName,
    );
  }

  private getCurrentBranchName(worktreePath: string): Promise<string> {
    return getCurrentBranchName(worktreePath);
  }

  private captureWorktreeCheckpoint(
    folderPath: string,
    worktreePath: string,
    checkpointId: string,
  ): Promise<void> {
    return captureWorktreeCheckpoint(folderPath, worktreePath, checkpointId);
  }

  private async restoreWorktreeFromCheckpoint(
    folderPath: string,
    workspace: Workspace,
    archive: Archive,
    recreateBranch?: boolean,
  ): Promise<string> {
    if (!archive.checkpointId) {
      throw new Error("checkpointId is required for restoring worktree");
    }
    const worktree = this.worktreeRepo.findByWorkspaceId(workspace.id);

    const newWorktree = await restoreWorktreeFromCheckpoint({
      mainRepoPath: folderPath,
      worktreeBasePath: this.workspaceSettings.getWorktreeLocation(),
      preferredName: worktree?.name ?? undefined,
      branchName: archive.branchName,
      checkpointId: archive.checkpointId,
      recreateBranch,
    });

    if (worktree) {
      this.worktreeRepo.deleteByWorkspaceId(workspace.id);
    }

    return newWorktree.worktreeName;
  }
}
