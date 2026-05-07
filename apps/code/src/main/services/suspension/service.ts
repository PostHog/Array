import fs from "node:fs/promises";
import path from "node:path";
import { createGitClient } from "@posthog/git/client";
import {
  CaptureCheckpointSaga,
  deleteCheckpoint,
  RevertCheckpointSaga,
} from "@posthog/git/sagas/checkpoint";
import { forceRemove } from "@posthog/git/utils";
import { type WorktreeInfo, WorktreeManager } from "@posthog/git/worktree";
import { inject, injectable } from "inversify";
import type { IArchiveRepository } from "../../db/repositories/archive-repository.js";
import type { IRepositoryRepository } from "../../db/repositories/repository-repository.js";
import type {
  SuspensionReason,
  SuspensionRepository,
} from "../../db/repositories/suspension-repository.js";
import type {
  IWorkspaceRepository,
  Workspace,
} from "../../db/repositories/workspace-repository.js";
import type { IWorktreeRepository } from "../../db/repositories/worktree-repository.js";
import { MAIN_TOKENS } from "../../di/tokens.js";
import { logger } from "../../utils/logger.js";
import { TypedEventEmitter } from "../../utils/typed-event-emitter.js";
import type { AgentService } from "../agent/service.js";
import type { FileWatcherService } from "../file-watcher/service.js";
import type { ProcessTrackingService } from "../process-tracking/service.js";
import {
  getAutoSuspendAfterDays,
  getAutoSuspendEnabled,
  getMaxActiveWorktrees,
  getWorktreeLocation,
  setAutoSuspendAfterDays,
  setAutoSuspendEnabled,
  setMaxActiveWorktrees,
} from "../settingsStore.js";
import type { SuspendedTask } from "./schemas.js";

const log = logger.scope("suspension");

type RollbackFn = () => Promise<void>;
type StepFn = (
  execute: () => Promise<void>,
  rollback?: RollbackFn,
) => Promise<void>;

export const SuspensionServiceEvent = {
  Suspended: "suspended",
  Restored: "restored",
} as const;

export interface SuspensionServiceEvents {
  [SuspensionServiceEvent.Suspended]: { taskId: string; reason: string };
  [SuspensionServiceEvent.Restored]: { taskId: string };
}

@injectable()
export class SuspensionService extends TypedEventEmitter<SuspensionServiceEvents> {
  private inactivityTimerId: ReturnType<typeof setInterval> | null = null;

  constructor(
    @inject(MAIN_TOKENS.AgentService)
    private readonly agentService: AgentService,
    @inject(MAIN_TOKENS.ProcessTrackingService)
    private readonly processTracking: ProcessTrackingService,
    @inject(MAIN_TOKENS.FileWatcherService)
    private readonly fileWatcher: FileWatcherService,
    @inject(MAIN_TOKENS.RepositoryRepository)
    private readonly repositoryRepo: IRepositoryRepository,
    @inject(MAIN_TOKENS.WorkspaceRepository)
    private readonly workspaceRepo: IWorkspaceRepository,
    @inject(MAIN_TOKENS.WorktreeRepository)
    private readonly worktreeRepo: IWorktreeRepository,
    @inject(MAIN_TOKENS.SuspensionRepository)
    private readonly suspensionRepo: SuspensionRepository,
    @inject(MAIN_TOKENS.ArchiveRepository)
    private readonly archiveRepo: IArchiveRepository,
  ) {
    super();
  }

  async suspendTask(
    taskId: string,
    reason: SuspensionReason,
  ): Promise<SuspendedTask> {
    log.info(`Suspending task ${taskId} (reason: ${reason})`);
    const result = await this.withRollback((step) =>
      this.executeSuspend(taskId, reason, step),
    );
    this.emit(SuspensionServiceEvent.Suspended, { taskId, reason });
    return result;
  }

  async restoreTask(
    taskId: string,
    recreateBranch?: boolean,
  ): Promise<{ taskId: string; worktreeName: string | null }> {
    log.info(
      `Restoring suspended task ${taskId}${recreateBranch ? " (recreate branch)" : ""}`,
    );
    const result = await this.withRollback((step) =>
      this.executeRestore(taskId, recreateBranch, step),
    );
    this.emit(SuspensionServiceEvent.Restored, { taskId });
    return result;
  }

  getSuspendedTasks(): SuspendedTask[] {
    return this.suspensionRepo.findAll().map((suspension) => {
      const workspace = this.workspaceRepo.findById(
        suspension.workspaceId,
      ) as Workspace;
      const worktree = this.worktreeRepo.findByWorkspaceId(workspace.id);
      return {
        taskId: workspace.taskId,
        suspendedAt: suspension.suspendedAt,
        reason: suspension.reason as SuspendedTask["reason"],
        folderId: workspace.repositoryId ?? "",
        mode: workspace.mode as SuspendedTask["mode"],
        worktreeName: worktree?.name ?? null,
        branchName: suspension.branchName,
        checkpointId: suspension.checkpointId,
      };
    });
  }

  getSuspendedTaskIds(): string[] {
    return this.getSuspendedTasks().map((t) => t.taskId);
  }

  isSuspended(taskId: string): boolean {
    const workspace = this.workspaceRepo.findByTaskId(taskId);
    if (!workspace) return false;
    return this.suspensionRepo.findByWorkspaceId(workspace.id) !== null;
  }

  async suspendLeastRecentIfOverLimit(): Promise<void> {
    if (!getAutoSuspendEnabled()) return;
    const maxActive = getMaxActiveWorktrees();
    const active = this.getActiveWorktreeWorkspaces();
    if (active.length < maxActive) return;

    const oldest = active.sort((a, b) => {
      const aTime = a.lastActivityAt ?? a.createdAt ?? "";
      const bTime = b.lastActivityAt ?? b.createdAt ?? "";
      return aTime.localeCompare(bTime);
    })[0];

    if (!oldest) return;
    log.info(
      `Auto-suspending task ${oldest.taskId} (max: ${maxActive}, active: ${active.length})`,
    );
    await this.autoSuspend(oldest.taskId, "max_worktrees");
  }

  async suspendInactiveWorktrees(): Promise<void> {
    if (!getAutoSuspendEnabled()) return;
    const thresholdDays = getAutoSuspendAfterDays();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - thresholdDays);
    const cutoffStr = cutoff.toISOString();

    const candidates = this.getActiveWorktreeWorkspaces().filter((ws) => {
      return (ws.lastActivityAt ?? ws.createdAt ?? "") < cutoffStr;
    });

    for (const ws of candidates) {
      log.info(
        `Auto-suspending inactive task ${ws.taskId} (last activity: ${ws.lastActivityAt ?? ws.createdAt})`,
      );
      await this.autoSuspend(ws.taskId, "inactivity");
    }
  }

  startInactivityChecker(): void {
    if (this.inactivityTimerId) return;
    const ONE_HOUR_MS = 60 * 60 * 1000;
    this.inactivityTimerId = setInterval(() => {
      this.suspendInactiveWorktrees().catch((error) => {
        log.error("Inactivity checker failed:", error);
      });
    }, ONE_HOUR_MS);
  }

  stopInactivityChecker(): void {
    if (!this.inactivityTimerId) return;
    clearInterval(this.inactivityTimerId);
    this.inactivityTimerId = null;
  }

  getSettings() {
    return {
      autoSuspendEnabled: getAutoSuspendEnabled(),
      maxActiveWorktrees: getMaxActiveWorktrees(),
      autoSuspendAfterDays: getAutoSuspendAfterDays(),
    };
  }

  updateSettings(settings: {
    autoSuspendEnabled?: boolean;
    maxActiveWorktrees?: number;
    autoSuspendAfterDays?: number;
  }) {
    if (settings.autoSuspendEnabled !== undefined)
      setAutoSuspendEnabled(settings.autoSuspendEnabled);
    if (settings.maxActiveWorktrees !== undefined)
      setMaxActiveWorktrees(settings.maxActiveWorktrees);
    if (settings.autoSuspendAfterDays !== undefined)
      setAutoSuspendAfterDays(settings.autoSuspendAfterDays);
  }

  private async withRollback<T>(fn: (step: StepFn) => Promise<T>): Promise<T> {
    const rollbacks: RollbackFn[] = [];
    const step: StepFn = async (execute, rollback) => {
      await execute();
      if (rollback) rollbacks.push(rollback);
    };

    try {
      return await fn(step);
    } catch (error) {
      for (const rollback of rollbacks.reverse()) {
        try {
          await rollback();
        } catch (e) {
          log.error("Rollback failed:", e);
        }
      }
      throw error;
    }
  }

  private getActiveWorktreeWorkspaces(): Workspace[] {
    return this.workspaceRepo.findAll().filter((ws) => {
      if (ws.mode !== "worktree") return false;
      if (this.suspensionRepo.findByWorkspaceId(ws.id)) return false;
      if (this.archiveRepo.findByWorkspaceId(ws.id)) return false;
      return true;
    });
  }

  private async autoSuspend(
    taskId: string,
    reason: SuspensionReason,
  ): Promise<void> {
    try {
      await this.suspendTask(taskId, reason);
    } catch (error) {
      log.error(`Failed to auto-suspend task ${taskId}:`, error);
    }
  }

  private getWorkspaceWithRepo(taskId: string) {
    const workspace = this.workspaceRepo.findByTaskId(taskId);
    if (!workspace) throw new Error(`Workspace not found for task ${taskId}`);

    let folderPath: string | null = null;
    if (workspace.repositoryId) {
      const repo = this.repositoryRepo.findById(workspace.repositoryId);
      if (!repo) throw new Error(`Repository not found for task ${taskId}`);
      folderPath = repo.path;
    }

    return { workspace, folderPath };
  }

  private createWorktreeManager(folderPath: string) {
    return new WorktreeManager({
      mainRepoPath: folderPath,
      worktreeBasePath: getWorktreeLocation(),
    });
  }

  private async deleteWorktreeOnDisk(
    folderPath: string,
    worktreePath: string,
  ): Promise<void> {
    const manager = this.createWorktreeManager(folderPath);
    await manager.deleteWorktree(worktreePath);
    await forceRemove(path.dirname(worktreePath));
  }

  private async killTaskProcesses(
    taskId: string,
    worktreePath?: string,
  ): Promise<void> {
    await this.agentService.cancelSessionsByTaskId(taskId);
    this.processTracking.killByTaskId(taskId);
    if (worktreePath) await this.fileWatcher.stopWatching(worktreePath);
  }

  private async executeSuspend(
    taskId: string,
    reason: SuspensionReason,
    step: StepFn,
  ): Promise<SuspendedTask> {
    const { workspace, folderPath } = this.getWorkspaceWithRepo(taskId);

    if (this.suspensionRepo.findByWorkspaceId(workspace.id))
      throw new Error(`Task ${taskId} is already suspended`);
    if (this.archiveRepo.findByWorkspaceId(workspace.id))
      throw new Error(`Task ${taskId} is already archived`);

    const worktree = this.worktreeRepo.findByWorkspaceId(workspace.id);
    const isWorktreeMode =
      workspace.mode === "worktree" && worktree && folderPath;

    const suspendedTask: SuspendedTask = {
      taskId,
      suspendedAt: new Date().toISOString(),
      reason,
      folderId: workspace.repositoryId ?? "",
      mode: workspace.mode,
      worktreeName: worktree?.name ?? null,
      branchName: null,
      checkpointId: isWorktreeMode ? `suspension-${worktree.name}` : null,
    };

    if (isWorktreeMode) {
      const worktreePath = worktree.path;

      const branch = await this.getCurrentBranchName(worktreePath);
      if (branch && branch !== "HEAD") suspendedTask.branchName = branch;

      const checkpointId = suspendedTask.checkpointId;
      if (!checkpointId)
        throw new Error("checkpointId must be set in worktree mode");

      await step(
        async () => {
          await this.captureWorktreeCheckpoint(
            folderPath,
            worktreePath,
            checkpointId,
          );
        },
        async () => {
          const git = createGitClient(folderPath);
          await deleteCheckpoint(git, checkpointId);
        },
      );

      await step(async () => this.killTaskProcesses(taskId, worktreePath));
      await step(async () =>
        this.deleteWorktreeOnDisk(folderPath, worktreePath),
      );
    } else {
      await step(async () => this.killTaskProcesses(taskId));
    }

    await step(
      async () => {
        this.suspensionRepo.create({
          workspaceId: workspace.id,
          branchName: suspendedTask.branchName,
          checkpointId: suspendedTask.checkpointId,
          reason,
        });
      },
      async () => this.suspensionRepo.deleteByWorkspaceId(workspace.id),
    );

    return suspendedTask;
  }

  private async executeRestore(
    taskId: string,
    recreateBranch: boolean | undefined,
    step: StepFn,
  ): Promise<{ taskId: string; worktreeName: string | null }> {
    const { workspace, folderPath } = this.getWorkspaceWithRepo(taskId);

    const suspension = this.suspensionRepo.findByWorkspaceId(workspace.id);
    if (!suspension) throw new Error(`Suspended task not found: ${taskId}`);

    const worktree = this.worktreeRepo.findByWorkspaceId(workspace.id);
    let restoredWorktreeName: string | null = worktree?.name ?? null;

    if (
      folderPath &&
      workspace.mode === "worktree" &&
      suspension.checkpointId
    ) {
      const checkpointId = suspension.checkpointId;
      await step(
        async () => {
          restoredWorktreeName = await this.restoreWorktreeFromCheckpoint(
            folderPath,
            workspace,
            suspension.branchName,
            checkpointId,
            recreateBranch,
          );
        },
        async () => {
          if (restoredWorktreeName) {
            const worktreePath = await this.deriveWorktreePath(
              folderPath,
              restoredWorktreeName,
            );
            await this.deleteWorktreeOnDisk(folderPath, worktreePath);
          }
        },
      );

      await step(
        async () => {
          if (!restoredWorktreeName)
            throw new Error("Failed to restore worktree");
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
        async () => this.worktreeRepo.deleteByWorkspaceId(workspace.id),
      );
    }

    await step(
      async () => this.suspensionRepo.deleteByWorkspaceId(workspace.id),
      async () => {
        this.suspensionRepo.create({
          workspaceId: workspace.id,
          branchName: suspension.branchName,
          checkpointId: suspension.checkpointId,
          reason: suspension.reason as SuspensionReason,
        });
      },
    );

    return { taskId, worktreeName: restoredWorktreeName };
  }

  private async getCurrentBranchName(worktreePath: string): Promise<string> {
    try {
      const git = createGitClient(worktreePath);
      return (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
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
    if (!result.success)
      throw new Error(`Failed to capture checkpoint: ${result.error}`);
  }

  private async restoreWorktreeFromCheckpoint(
    folderPath: string,
    workspace: Workspace,
    branchName: string | null,
    checkpointId: string,
    recreateBranch?: boolean,
  ): Promise<string> {
    const worktree = this.worktreeRepo.findByWorkspaceId(workspace.id);
    const manager = this.createWorktreeManager(folderPath);
    const preferredName = worktree?.name ?? undefined;

    let newWorktree: WorktreeInfo;
    if (branchName && !recreateBranch) {
      newWorktree = await manager.createWorktreeForExistingBranch(
        branchName,
        preferredName,
      );
    } else {
      newWorktree = await manager.createDetachedWorktreeAtCommit(
        "HEAD",
        preferredName,
      );
    }

    const revertSaga = new RevertCheckpointSaga();
    const result = await revertSaga.run({
      baseDir: newWorktree.worktreePath,
      checkpointId,
    });
    if (!result.success)
      throw new Error(
        `Worktree restored but failed to apply checkpoint: ${result.error}`,
      );

    if (recreateBranch && branchName) {
      const git = createGitClient(newWorktree.worktreePath);
      await git.checkoutLocalBranch(branchName);
    }

    if (worktree) this.worktreeRepo.deleteByWorkspaceId(workspace.id);
    return newWorktree.worktreeName;
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
}
