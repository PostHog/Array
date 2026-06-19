import * as fs from "node:fs";
import path from "node:path";
import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import { createGitClient } from "@posthog/git/client";
import {
  branchExists,
  getCurrentBranch,
  getDefaultBranch,
  hasTrackedFiles,
  remoteBranchExists,
} from "@posthog/git/queries";
import { CreateOrSwitchBranchSaga } from "@posthog/git/sagas/branch";
import { DetachHeadSaga } from "@posthog/git/sagas/head";
import { WorktreeManager } from "@posthog/git/worktree";
import {
  ANALYTICS_SERVICE,
  type IAnalytics,
} from "@posthog/platform/analytics";
import {
  type IWorkspaceSettings,
  WORKSPACE_SETTINGS_SERVICE,
} from "@posthog/platform/workspace-settings";
import { ANALYTICS_EVENTS, TypedEventEmitter } from "@posthog/shared";
import { inject, injectable } from "inversify";
import {
  REPOSITORY_REPOSITORY,
  WORKSPACE_REPOSITORY,
  WORKTREE_REPOSITORY,
} from "../../db/identifiers";
import type { IRepositoryRepository } from "../../db/repositories/repository-repository";
import type { IWorkspaceRepository } from "../../db/repositories/workspace-repository";
import type { IWorktreeRepository } from "../../db/repositories/worktree-repository";
import { PROCESS_TRACKING_SERVICE } from "../process-tracking/identifiers";
import type { ProcessTrackingService } from "../process-tracking/process-tracking";
import { getBranchFromPath, hasAnyFiles } from "../repo-fs-query/repo-fs-query";
import { SUSPENSION_SERVICE } from "../suspension/identifiers";
import type { SuspensionService } from "../suspension/suspension";
import {
  deleteWorktree as deleteGitWorktree,
  listTwigWorktrees,
  resolveLocalWorktreePath,
} from "../worktree-query/worktree-query";
import {
  WORKSPACE_AGENT,
  WORKSPACE_FILE_WATCHER,
  WORKSPACE_FOCUS,
  WORKSPACE_PROVISIONING,
} from "./identifiers";
import type {
  WorkspaceAgent,
  WorkspaceFileWatcher,
  WorkspaceFocus,
  WorkspaceProvisioning,
} from "./ports";
import type {
  BranchChangedPayload,
  CheckWorktreeBranchInput,
  CheckWorktreeBranchOutput,
  CreateWorkspaceInput,
  LinkedBranchChangedPayload,
  ReconcileCloudWorkspacesOutput,
  TaskPrInfoChangedPayload,
  Workspace,
  WorkspaceErrorPayload,
  WorkspaceInfo,
  WorkspacePromotedPayload,
  WorkspaceWarningPayload,
  WorktreeInfo,
} from "./schemas";

type TaskAssociation =
  | { taskId: string; folderId: string; mode: "local" }
  | { taskId: string; folderId: string | null; mode: "cloud" }
  | {
      taskId: string;
      folderId: string;
      mode: "worktree";
      /** Cosmetic worktree name, surfaced as `worktreeName` in projections. */
      worktree: string;
      /** Authoritative on-disk worktree path, read from the stored row. */
      path: string;
      branchName: string | null;
    };

/** True when `child` resolves to a path strictly inside `parent`. */
function isPathUnder(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  const up = `..${path.sep}`;
  return (
    rel !== "" && rel !== ".." && !rel.startsWith(up) && !path.isAbsolute(rel)
  );
}

export const WorkspaceServiceEvent = {
  Error: "error",
  Warning: "warning",
  Promoted: "promoted",
  BranchChanged: "branchChanged",
  LinkedBranchChanged: "linkedBranchChanged",
  TaskPrInfoChanged: "taskPrInfoChanged",
} as const;

export interface WorkspaceServiceEvents {
  [WorkspaceServiceEvent.Error]: WorkspaceErrorPayload;
  [WorkspaceServiceEvent.Warning]: WorkspaceWarningPayload;
  [WorkspaceServiceEvent.Promoted]: WorkspacePromotedPayload;
  [WorkspaceServiceEvent.BranchChanged]: BranchChangedPayload;
  [WorkspaceServiceEvent.LinkedBranchChanged]: LinkedBranchChangedPayload;
  [WorkspaceServiceEvent.TaskPrInfoChanged]: TaskPrInfoChangedPayload;
}

@injectable()
export class WorkspaceService extends TypedEventEmitter<WorkspaceServiceEvents> {
  private readonly log: ScopedLogger;

  constructor(
    @inject(WORKSPACE_AGENT)
    private readonly agent: WorkspaceAgent,
    @inject(PROCESS_TRACKING_SERVICE)
    private readonly processTracking: ProcessTrackingService,
    @inject(REPOSITORY_REPOSITORY)
    private readonly repositoryRepo: IRepositoryRepository,
    @inject(WORKSPACE_REPOSITORY)
    private readonly workspaceRepo: IWorkspaceRepository,
    @inject(WORKTREE_REPOSITORY)
    private readonly worktreeRepo: IWorktreeRepository,
    @inject(SUSPENSION_SERVICE)
    private readonly suspensionService: SuspensionService,
    @inject(WORKSPACE_PROVISIONING)
    private readonly provisioning: WorkspaceProvisioning,
    @inject(WORKSPACE_FILE_WATCHER)
    private readonly fileWatcher: WorkspaceFileWatcher,
    @inject(WORKSPACE_FOCUS)
    private readonly focus: WorkspaceFocus,
    @inject(WORKSPACE_SETTINGS_SERVICE)
    private readonly workspaceSettings: IWorkspaceSettings,
    @inject(ANALYTICS_SERVICE)
    private readonly analytics: IAnalytics,
    @inject(ROOT_LOGGER)
    logger: RootLogger,
  ) {
    super();
    this.log = logger.scope("workspace");
  }

  private creatingWorkspaces = new Map<string, Promise<WorkspaceInfo>>();
  private branchWatcherInitialized = false;

  private findTaskAssociation(taskId: string): TaskAssociation | null {
    const workspace = this.workspaceRepo.findByTaskId(taskId);
    if (!workspace) return null;

    if (workspace.mode === "cloud") {
      return {
        taskId,
        folderId: workspace.repositoryId,
        mode: "cloud",
      };
    }

    if (!workspace.repositoryId) return null;

    if (workspace.mode === "worktree") {
      const worktree = this.worktreeRepo.findByWorkspaceId(workspace.id);
      if (!worktree) return null;
      return {
        taskId,
        folderId: workspace.repositoryId,
        mode: "worktree",
        worktree: worktree.name,
        path: worktree.path,
        branchName: null,
      };
    }

    return {
      taskId,
      folderId: workspace.repositoryId,
      mode: "local",
    };
  }

  private getFolderPath(folderId: string): string | null {
    const repo = this.repositoryRepo.findById(folderId);
    return repo?.path ?? null;
  }

  private getAllTaskAssociations(): TaskAssociation[] {
    const workspaces = this.workspaceRepo.findAll();
    const result: TaskAssociation[] = [];

    for (const workspace of workspaces) {
      if (workspace.mode === "cloud") {
        result.push({
          taskId: workspace.taskId,
          folderId: workspace.repositoryId,
          mode: "cloud",
        });
        continue;
      }

      if (!workspace.repositoryId) continue;

      if (workspace.mode === "worktree") {
        const worktree = this.worktreeRepo.findByWorkspaceId(workspace.id);
        if (!worktree) continue;
        result.push({
          taskId: workspace.taskId,
          folderId: workspace.repositoryId,
          mode: "worktree",
          worktree: worktree.name,
          path: worktree.path,
          branchName: null,
        });
      } else {
        result.push({
          taskId: workspace.taskId,
          folderId: workspace.repositoryId,
          mode: "local",
        });
      }
    }

    return result;
  }

  /**
   * Initialize branch change watching. Should be called after app is ready.
   * Subscribes to GitStateChanged events and checks for branch renames.
   */
  initBranchWatcher(): void {
    if (this.branchWatcherInitialized) return;
    this.branchWatcherInitialized = true;

    this.fileWatcher.onGitStateChanged(this.handleGitStateChanged.bind(this));

    this.focus.onBranchRenamed(this.handleFocusBranchRenamed.bind(this));

    this.agent.onAgentFileActivity(this.handleAgentFileActivity.bind(this));
  }

  private handleFocusBranchRenamed({
    worktreePath,
    newBranch,
  }: {
    mainRepoPath: string;
    worktreePath: string;
    oldBranch: string;
    newBranch: string;
  }): void {
    const associations = this.getAllTaskAssociations();
    for (const assoc of associations) {
      if (assoc.mode !== "worktree") continue;
      if (assoc.path === worktreePath && assoc.branchName !== newBranch) {
        this.updateAssociationBranchName(assoc.taskId, newBranch);
        this.emit(WorkspaceServiceEvent.BranchChanged, {
          taskId: assoc.taskId,
          branchName: newBranch,
        });
      }
    }
  }

  private async handleGitStateChanged({
    repoPath,
  }: {
    repoPath: string;
  }): Promise<void> {
    const associations = this.getAllTaskAssociations();

    for (const assoc of associations) {
      if (assoc.mode === "cloud" || !assoc.folderId) continue;

      const folderPath = this.getFolderPath(assoc.folderId);
      if (!folderPath) continue;

      if (assoc.mode === "worktree") {
        if (assoc.path !== repoPath) continue;

        const currentBranch = await getBranchFromPath(repoPath);
        if (currentBranch !== null && currentBranch !== assoc.branchName) {
          this.updateAssociationBranchName(assoc.taskId, currentBranch);
          this.emit(WorkspaceServiceEvent.BranchChanged, {
            taskId: assoc.taskId,
            branchName: currentBranch,
          });
        }
      } else if (assoc.mode === "local") {
        if (folderPath !== repoPath) continue;

        const localWorktreePath =
          await this.getLocalWorktreePathIfExists(folderPath);
        const branchPath = localWorktreePath ?? folderPath;
        const currentBranch = await getBranchFromPath(branchPath);

        if (currentBranch === null && localWorktreePath) {
          continue;
        }

        this.emit(WorkspaceServiceEvent.BranchChanged, {
          taskId: assoc.taskId,
          branchName: currentBranch,
        });
      }
    }
  }

  private async handleAgentFileActivity({
    taskId,
    branchName,
  }: {
    taskId: string;
    branchName: string | null;
  }): Promise<void> {
    if (!branchName) return;

    const dbRow = this.workspaceRepo.findByTaskId(taskId);
    if (!dbRow || dbRow.mode !== "local") return;
    if (!dbRow.repositoryId) return;

    const folderPath = this.getFolderPath(dbRow.repositoryId);
    if (!folderPath) return;

    try {
      const defaultBranch = await getDefaultBranch(folderPath);
      if (branchName === defaultBranch) return;
    } catch (error) {
      this.log.warn(
        "Failed to determine default branch, skipping branch link",
        {
          taskId,
          branchName,
          error,
        },
      );
      this.analytics.track(
        ANALYTICS_EVENTS.BRANCH_LINK_DEFAULT_BRANCH_UNKNOWN,
        {
          task_id: taskId,
          branch_name: branchName,
        },
      );
      return;
    }

    const currentLinked = dbRow.linkedBranch ?? null;
    if (currentLinked === branchName) return;

    this.linkBranch(taskId, branchName, "agent");
  }

  private updateAssociationBranchName(
    _taskId: string,
    _branchName: string,
  ): void {}

  public linkBranch(
    taskId: string,
    branchName: string,
    source?: "agent" | "user",
  ): void {
    this.workspaceRepo.updateLinkedBranch(taskId, branchName);
    this.emit(WorkspaceServiceEvent.LinkedBranchChanged, {
      taskId,
      branchName,
    });
    this.analytics.track(ANALYTICS_EVENTS.BRANCH_LINKED, {
      task_id: taskId,
      branch_name: branchName,
      source: source ?? "unknown",
    });
    this.log.info("Linked branch to task", { taskId, branchName, source });
  }

  public unlinkBranch(taskId: string, source?: "agent" | "user"): void {
    this.workspaceRepo.updateLinkedBranch(taskId, null);
    this.emit(WorkspaceServiceEvent.LinkedBranchChanged, {
      taskId,
      branchName: null,
    });
    this.analytics.track(ANALYTICS_EVENTS.BRANCH_UNLINKED, {
      task_id: taskId,
      source: source ?? "unknown",
    });
    this.log.info("Unlinked branch from task", { taskId, source });
  }

  private getLocalWorktreePathIfExists(
    mainRepoPath: string,
  ): Promise<string | null> {
    return resolveLocalWorktreePath(
      mainRepoPath,
      this.workspaceSettings.getWorktreeLocation(),
    );
  }

  // Batched cloud-workspace reconcile. The renderer calls this once on boot
  // with every cloud taskId it sees that has no local workspace row, instead
  // of firing one createWorkspace mutation per task. With 100+ cloud tasks
  // the N-call pattern saturates the main thread on the tRPC IPC path; this
  // collapses it to one IPC + one batched insert.
  async reconcileCloudWorkspaces(
    taskIds: string[],
  ): Promise<ReconcileCloudWorkspacesOutput> {
    if (taskIds.length === 0) return { created: [] };

    const existingTaskIds = new Set(
      this.workspaceRepo.findAll().map((w) => w.taskId),
    );
    const uniqueRequested = Array.from(new Set(taskIds));
    const toCreate = uniqueRequested.filter((id) => !existingTaskIds.has(id));
    if (toCreate.length === 0) return { created: [] };

    this.log.info(
      `Reconciling ${toCreate.length} cloud workspaces (requested ${taskIds.length})`,
    );
    this.workspaceRepo.createCloudMany(toCreate);
    return { created: toCreate };
  }

  /**
   * Reports whether a branch the user picked for a worktree is the trunk,
   * exists locally, exists only on the remote, or cannot be found. The renderer
   * uses "remote-only" to prompt before checking the branch out locally.
   */
  async checkWorktreeBranch(
    options: CheckWorktreeBranchInput,
    signal?: AbortSignal,
  ): Promise<CheckWorktreeBranchOutput> {
    const { mainRepoPath, branch } = options;

    const defaultBranch = await getDefaultBranch(mainRepoPath, {
      abortSignal: signal,
    }).catch(() =>
      getCurrentBranch(mainRepoPath, { abortSignal: signal }).then(
        (b) => b ?? "main",
      ),
    );
    if (branch === defaultBranch) {
      return { status: "trunk" };
    }

    if (await branchExists(mainRepoPath, branch, { abortSignal: signal })) {
      return { status: "local" };
    }

    if (
      await remoteBranchExists(mainRepoPath, branch, { abortSignal: signal })
    ) {
      return { status: "remote-only" };
    }

    return { status: "missing" };
  }

  async createWorkspace(options: CreateWorkspaceInput): Promise<WorkspaceInfo> {
    // Prevent concurrent workspace creation for the same task
    const existingPromise = this.creatingWorkspaces.get(options.taskId);
    if (existingPromise) {
      this.log.warn(
        `Workspace creation already in progress for task ${options.taskId}, waiting for existing operation`,
      );
      return existingPromise;
    }

    const promise = this.doCreateWorkspace(options);
    this.creatingWorkspaces.set(options.taskId, promise);

    try {
      return await promise;
    } finally {
      this.creatingWorkspaces.delete(options.taskId);
    }
  }

  private async doCreateWorkspace(
    options: CreateWorkspaceInput,
  ): Promise<WorkspaceInfo> {
    const {
      taskId,
      mainRepoPath,
      folderPath,
      mode,
      branch,
      useExistingBranch,
      allowRemoteBranchCheckout,
    } = options;

    const existingWorkspace = await this.getWorkspaceInfo(taskId);
    if (existingWorkspace) {
      this.log.info(
        `Workspace already exists for task ${taskId}, returning existing workspace`,
      );
      return existingWorkspace;
    }

    this.log.info(
      `Creating workspace for task ${taskId} in ${mainRepoPath} (mode: ${mode}, useExistingBranch: ${useExistingBranch})`,
    );

    const repository = this.repositoryRepo.findByPath(mainRepoPath);
    const repositoryId = repository?.id ?? null;

    if (mode === "cloud") {
      this.workspaceRepo.create({
        taskId,
        repositoryId,
        mode: "cloud",
      });

      return {
        taskId,
        mode,
        worktree: null,
        branchName: null,
        linkedBranch: null,
      };
    }

    if (mode === "local") {
      if (branch) {
        const currentBranch = await getCurrentBranch(folderPath);
        if (currentBranch === branch) {
          this.log.info(`Already on branch ${branch}, skipping checkout`);
        } else {
          this.log.info(
            `Creating/switching to branch ${branch} for task ${taskId}`,
          );
          const saga = new CreateOrSwitchBranchSaga();
          const result = await saga.run({
            baseDir: folderPath,
            branchName: branch,
          });
          if (!result.success) {
            const message = `Could not switch to branch "${branch}". Please commit or stash your changes first.`;
            this.log.error(message, result.error);
            this.emitWorkspaceError(taskId, message);
            throw new Error(message);
          }
          if (result.data.created) {
            this.log.info(`Created and switched to new branch ${branch}`);
          } else {
            this.log.info(`Switched to existing branch ${branch}`);
          }
        }
      }

      this.workspaceRepo.create({
        taskId,
        repositoryId,
        mode: "local",
      });

      const localBranch = await getBranchFromPath(folderPath);
      return {
        taskId,
        mode,
        worktree: null,
        branchName: localBranch,
        linkedBranch: null,
      };
    }

    await this.suspensionService.suspendLeastRecentIfOverLimit();

    const worktreeBasePath = this.workspaceSettings.getWorktreeLocation();
    const worktreeManager = new WorktreeManager({
      mainRepoPath,
      worktreeBasePath,
    });
    let worktree: WorktreeInfo;

    try {
      const defaultBranch = await getDefaultBranch(mainRepoPath).catch(() =>
        getCurrentBranch(mainRepoPath).then((b) => b ?? "main"),
      );
      const selectedBranch = branch ?? defaultBranch;
      const isTrunkSelected = selectedBranch === defaultBranch;

      const onOutput = (data: string) => {
        this.provisioning.emitOutput(taskId, data);
      };

      if (isTrunkSelected) {
        this.log.info(
          `Trunk branch selected (${defaultBranch}), creating detached worktree`,
        );
        worktree = await worktreeManager.createWorktree({
          baseBranch: defaultBranch,
          onOutput,
          fetchBeforeCreate: true,
        });
        this.log.info(
          `Created detached worktree from trunk: ${worktree.worktreeName} at ${worktree.worktreePath}`,
        );
      } else {
        this.log.info(
          `Non-trunk branch selected (${selectedBranch}), attempting checkout`,
        );
        try {
          worktree = await worktreeManager.createWorktreeForExistingBranch(
            selectedBranch,
            undefined,
            { onOutput },
          );
          this.log.info(
            `Created worktree with branch checkout: ${worktree.worktreeName} at ${worktree.worktreePath} (branch: ${selectedBranch})`,
          );
        } catch (checkoutError) {
          const errorMessage =
            checkoutError instanceof Error
              ? checkoutError.message
              : String(checkoutError);
          if (errorMessage.includes("is already used by worktree")) {
            this.log.info(
              `Branch ${selectedBranch} is occupied, falling back to detached worktree`,
            );
            worktree = await worktreeManager.createWorktree({
              baseBranch: selectedBranch,
              onOutput,
            });
            this.log.info(
              `Created detached worktree from occupied branch: ${worktree.worktreeName} at ${worktree.worktreePath}`,
            );
          } else if (
            allowRemoteBranchCheckout &&
            // Matches the exact message createWorktreeForExistingBranch throws
            // for a missing local branch, mirroring the occupied-branch check
            // above. Both keys off the controlled git/worktree error text.
            errorMessage.includes(`Branch '${selectedBranch}' does not exist`)
          ) {
            this.log.info(
              `Branch ${selectedBranch} is not local; checking it out from the remote`,
            );
            worktree = await worktreeManager.createWorktreeForRemoteBranch(
              selectedBranch,
              undefined,
              { onOutput },
            );
            this.log.info(
              `Created worktree from remote branch: ${worktree.worktreeName} at ${worktree.worktreePath} (branch: ${selectedBranch})`,
            );
          } else {
            throw checkoutError;
          }
        }
      }

      // Warn if worktree is empty but main repo has files
      const worktreeHasFiles = await hasTrackedFiles(worktree.worktreePath);
      if (!worktreeHasFiles) {
        const mainHasFiles = await hasAnyFiles(mainRepoPath);
        if (mainHasFiles) {
          this.log.warn(
            `Worktree ${worktree.worktreeName} is empty but main repo has files`,
          );
          this.emitWorkspaceWarning(
            taskId,
            "Workspace is empty",
            "No files are committed yet. Commit your files to see them in workspaces.",
          );
        }
      }
    } catch (error) {
      this.log.error(`Failed to create worktree for task ${taskId}:`, error);
      throw new Error(`Failed to create worktree: ${String(error)}`);
    }

    const createdWorkspace = this.workspaceRepo.create({
      taskId,
      repositoryId,
      mode: "worktree",
    });

    this.worktreeRepo.create({
      workspaceId: createdWorkspace.id,
      name: worktree.worktreeName,
      path: worktree.worktreePath,
    });

    return {
      taskId,
      mode,
      worktree,
      branchName: worktree.branchName,
      linkedBranch: null,
    };
  }

  async deleteWorkspace(taskId: string, mainRepoPath: string): Promise<void> {
    this.log.info(`Deleting workspace for task ${taskId}`);

    const association = this.findTaskAssociation(taskId);
    if (!association) {
      this.log.warn(`No workspace found for task ${taskId}`);
      return;
    }

    if (association.mode === "cloud") {
      this.removeTaskAssociation(taskId);
      this.log.info(`Cloud workspace deleted for task ${taskId}`);
      return;
    }

    const folderId = association.folderId;
    const folderPath = this.getFolderPath(folderId);
    if (!folderPath) {
      this.log.warn(
        `No folder found for task ${taskId}, removing association only`,
      );
      this.removeTaskAssociation(taskId);
      return;
    }

    let worktreePath: string | null = null;

    if (association.mode === "worktree") {
      worktreePath = association.path;
    }

    await this.agent.cancelSessionsByTaskId(taskId);
    this.processTracking.killByTaskId(taskId);

    if (association.mode === "worktree" && worktreePath) {
      await this.cleanupWorktree(
        taskId,
        mainRepoPath,
        worktreePath,
        association.branchName,
      );

      const otherWorkspacesForFolder = this.getAllTaskAssociations().filter(
        (a) =>
          a.folderId === folderId &&
          a.taskId !== taskId &&
          a.mode === "worktree",
      );

      if (otherWorkspacesForFolder.length === 0) {
        await this.cleanupRepoWorktreeFolder(folderPath, worktreePath);
      }
    }

    this.removeTaskAssociation(taskId);

    this.log.info(`Workspace deleted for task ${taskId}`);
  }

  private removeTaskAssociation(taskId: string): void {
    const workspace = this.workspaceRepo.findByTaskId(taskId);
    if (workspace) {
      this.worktreeRepo.deleteByWorkspaceId(workspace.id);
    }
    this.workspaceRepo.deleteByTaskId(taskId);
  }

  /**
   * Reclaims the managed `<base>/<repo>` parent folder once its last worktree is
   * gone. The folder that gets removed is derived from `folderPath`, not from
   * `worktreePath`; `worktreePath` is read only to confirm the deleted worktree
   * was managed (lived under the base path) before reclaiming anything.
   */
  private async cleanupRepoWorktreeFolder(
    folderPath: string,
    worktreePath: string,
  ): Promise<void> {
    const worktreeBasePath = this.workspaceSettings.getWorktreeLocation();

    // Only reclaim the managed `<base>/<repo>` parent folder for worktrees that
    // actually live under the managed base path. Externally located worktrees
    // never created it, so its contents are unrelated.
    if (!isPathUnder(worktreePath, worktreeBasePath)) {
      return;
    }

    const repoName = path.basename(folderPath);
    const repoWorktreeFolderPath = path.join(worktreeBasePath, repoName);

    // Safety check 1: Never delete the project folder itself
    if (path.resolve(repoWorktreeFolderPath) === path.resolve(folderPath)) {
      this.log.warn(
        `Skipping cleanup of worktree folder: path matches project folder (${folderPath})`,
      );
      return;
    }

    if (!fs.existsSync(repoWorktreeFolderPath)) {
      return;
    }

    const allFolders = this.repositoryRepo.findAll();
    const otherFoldersWithSameName = allFolders.filter(
      (f) => f.path !== folderPath && path.basename(f.path) === repoName,
    );

    if (otherFoldersWithSameName.length > 0) {
      this.log.info(
        `Skipping cleanup of worktree folder ${repoWorktreeFolderPath}: used by other folders: ${otherFoldersWithSameName.map((f) => f.path).join(", ")}`,
      );
      return;
    }

    try {
      // Safety check 3: Only delete if empty (ignoring .DS_Store)
      const files = fs.readdirSync(repoWorktreeFolderPath);
      const validFiles = files.filter((f) => f !== ".DS_Store");

      if (validFiles.length > 0) {
        this.log.info(
          `Skipping cleanup of worktree folder ${repoWorktreeFolderPath}: folder not empty (contains: ${validFiles.slice(0, 3).join(", ")}${validFiles.length > 3 ? "..." : ""})`,
        );
        return;
      }

      fs.rmSync(repoWorktreeFolderPath, { recursive: true, force: true });
      this.log.info(`Cleaned up worktree folder at ${repoWorktreeFolderPath}`);
    } catch (error) {
      this.log.warn(
        `Failed to cleanup worktree folder at ${repoWorktreeFolderPath}:`,
        error,
      );
    }
  }

  async verifyWorkspaceExists(
    taskId: string,
  ): Promise<{ exists: boolean; missingPath?: string }> {
    const association = this.findTaskAssociation(taskId);
    if (!association) {
      return { exists: false };
    }

    if (association.mode === "cloud") {
      return { exists: true };
    }

    const folderPath = this.getFolderPath(association.folderId);
    if (!folderPath) {
      return { exists: false, missingPath: "(folder not found)" };
    }

    if (association.mode === "local") {
      const exists = fs.existsSync(folderPath);
      if (!exists) {
        this.log.info(`Folder for task ${taskId} no longer exists`);
        return { exists: false, missingPath: folderPath };
      }
      return { exists: true };
    }

    if (association.mode === "worktree") {
      const worktreePath = association.path;
      const exists = fs.existsSync(worktreePath);
      if (!exists) {
        this.log.info(`Worktree for task ${taskId} no longer exists`);
        return { exists: false, missingPath: worktreePath };
      }
      return { exists: true };
    }

    return { exists: false };
  }

  async getWorkspace(taskId: string): Promise<Workspace | null> {
    const assoc = this.findTaskAssociation(taskId);
    if (!assoc) return null;

    const dbRow = this.workspaceRepo.findByTaskId(taskId);
    const linkedBranch = dbRow?.linkedBranch ?? null;

    if (assoc.mode === "cloud") {
      return {
        taskId,
        folderId: assoc.folderId ?? "",
        folderPath: "",
        mode: "cloud",
        worktreePath: null,
        worktreeName: null,
        branchName: null,
        baseBranch: null,
        linkedBranch,
        createdAt: new Date().toISOString(),
      };
    }

    const folderPath = this.getFolderPath(assoc.folderId);
    if (!folderPath) return null;

    let worktreePath: string | null = null;
    let worktreeName: string | null = null;
    let branchName: string | null = null;

    if (assoc.mode === "worktree") {
      worktreeName = assoc.worktree;
      worktreePath = assoc.path;
      const gitBranch = await getBranchFromPath(worktreePath);
      branchName = gitBranch ?? assoc.branchName;
    } else if (assoc.mode === "local") {
      const localWorktreePath =
        await this.getLocalWorktreePathIfExists(folderPath);
      const branchPath = localWorktreePath ?? folderPath;
      branchName = await getBranchFromPath(branchPath);
    }

    return {
      taskId,
      folderId: assoc.folderId,
      folderPath,
      mode: assoc.mode,
      worktreePath,
      worktreeName,
      branchName,
      baseBranch: null,
      linkedBranch,
      createdAt: new Date().toISOString(),
    };
  }

  async getWorkspaceInfo(taskId: string): Promise<WorkspaceInfo | null> {
    const association = this.findTaskAssociation(taskId);
    if (!association) {
      return null;
    }

    const dbRow = this.workspaceRepo.findByTaskId(taskId);

    if (association.mode === "cloud") {
      return {
        taskId,
        mode: "cloud",
        worktree: null,
        branchName: null,
        linkedBranch: dbRow?.linkedBranch ?? null,
      };
    }

    const folderPath = association.folderId
      ? this.getFolderPath(association.folderId)
      : null;
    let worktreeInfo: WorktreeInfo | null = null;
    let branchName: string | null = null;

    if (association.mode === "worktree" && folderPath) {
      const worktreePath = association.path;
      const gitBranch = await getBranchFromPath(worktreePath);
      branchName = gitBranch ?? association.branchName;
      worktreeInfo = {
        worktreePath,
        worktreeName: association.worktree,
        branchName,
        baseBranch: "main",
        createdAt: new Date().toISOString(),
      };
    } else if (association.mode === "local" && folderPath) {
      branchName = await getBranchFromPath(folderPath);
    }

    return {
      taskId,
      mode: association.mode,
      worktree: worktreeInfo,
      branchName,
      linkedBranch: dbRow?.linkedBranch ?? null,
    };
  }

  async getAllWorkspaces(): Promise<Record<string, Workspace>> {
    const associations = this.getAllTaskAssociations();
    const dbRows = this.workspaceRepo.findAll();
    const linkedBranchByTaskId = new Map(
      dbRows.map((row) => [row.taskId, row.linkedBranch ?? null]),
    );
    const workspaces: Record<string, Workspace> = {};

    for (const assoc of associations) {
      if (assoc.mode === "cloud") {
        workspaces[assoc.taskId] = {
          taskId: assoc.taskId,
          folderId: assoc.folderId ?? "",
          folderPath: "",
          mode: "cloud",
          worktreePath: null,
          worktreeName: null,
          branchName: null,
          baseBranch: null,
          linkedBranch: linkedBranchByTaskId.get(assoc.taskId) ?? null,
          createdAt: new Date().toISOString(),
        };
        continue;
      }

      const folderPath = this.getFolderPath(assoc.folderId);
      if (!folderPath) continue;

      let worktreePath: string | null = null;
      let worktreeName: string | null = null;

      if (assoc.mode === "worktree") {
        worktreeName = assoc.worktree;
        worktreePath = assoc.path;
      }

      let branchName: string | null = null;
      if (assoc.mode === "worktree" && worktreePath) {
        const gitBranch = await getBranchFromPath(worktreePath);
        branchName = gitBranch ?? assoc.branchName;
      } else if (assoc.mode === "local") {
        const localWorktreePath =
          await this.getLocalWorktreePathIfExists(folderPath);
        const branchPath = localWorktreePath ?? folderPath;
        branchName = await getBranchFromPath(branchPath);
      }

      workspaces[assoc.taskId] = {
        taskId: assoc.taskId,
        folderId: assoc.folderId,
        folderPath,
        mode: assoc.mode,
        worktreePath,
        worktreeName,
        branchName,
        baseBranch: null,
        linkedBranch: linkedBranchByTaskId.get(assoc.taskId) ?? null,
        createdAt: new Date().toISOString(),
      };
    }

    return workspaces;
  }

  /**
   * Promote a local-mode task to worktree mode on an existing branch.
   * This is used when focusing on another workspace would disrupt a local-mode task.
   * The task gets its own worktree so it can continue working undisturbed.
   */
  async promoteToWorktree(
    taskId: string,
    mainRepoPath: string,
    branch: string,
  ): Promise<WorktreeInfo | null> {
    this.log.info(
      `Promoting task ${taskId} to worktree mode on branch ${branch}`,
    );

    const association = this.findTaskAssociation(taskId);
    if (!association) {
      this.log.warn(`No association found for task ${taskId}`);
      return null;
    }

    if (association.mode !== "local") {
      this.log.warn(`Task ${taskId} is not in local mode, cannot promote`);
      return null;
    }

    const worktreeBasePath = this.workspaceSettings.getWorktreeLocation();
    const worktreeManager = new WorktreeManager({
      mainRepoPath,
      worktreeBasePath,
    });

    let worktree: WorktreeInfo;
    try {
      const currentBranch = await getCurrentBranch(mainRepoPath);
      if (currentBranch === branch) {
        this.log.info(
          `Main repo is on target branch ${branch}, detaching before creating worktree`,
        );
        const detachSaga = new DetachHeadSaga();
        const detachResult = await detachSaga.run({ baseDir: mainRepoPath });
        if (!detachResult.success) {
          throw new Error(`Failed to detach HEAD: ${detachResult.error}`);
        }
      }

      worktree = await worktreeManager.createWorktreeForExistingBranch(branch);
      this.log.info(
        `Created worktree for promoted task: ${worktree.worktreeName} at ${worktree.worktreePath}`,
      );
    } catch (error) {
      this.log.error(
        `Failed to create worktree for promoted task ${taskId}:`,
        error,
      );
      throw new Error(`Failed to promote task to worktree: ${String(error)}`);
    }

    const workspace = this.workspaceRepo.findByTaskId(taskId);
    if (workspace) {
      this.workspaceRepo.updateMode(taskId, "worktree");
      this.worktreeRepo.create({
        workspaceId: workspace.id,
        name: worktree.worktreeName,
        path: worktree.worktreePath,
      });
      this.log.info(`Updated task ${taskId} association to worktree mode`);
    }

    this.emit(WorkspaceServiceEvent.Promoted, {
      taskId,
      worktree,
      fromBranch: branch,
    });

    return worktree;
  }

  getLocalTasksForFolder(folderPath: string): Array<{ taskId: string }> {
    const associations = this.getAllTaskAssociations();
    const folder = this.repositoryRepo.findByPath(folderPath);
    if (!folder) return [];

    return associations
      .filter((a) => a.mode === "local" && a.folderId === folder.id)
      .map((a) => ({ taskId: a.taskId }));
  }

  getWorktreeTasks(worktreePath: string): Array<{ taskId: string }> {
    const associations = this.getAllTaskAssociations();
    const result: Array<{ taskId: string }> = [];

    for (const assoc of associations) {
      if (assoc.mode !== "worktree") continue;
      if (assoc.path === worktreePath) {
        result.push({ taskId: assoc.taskId });
      }
    }

    return result;
  }

  async listGitWorktrees(mainRepoPath: string): Promise<
    Array<{
      worktreePath: string;
      head: string;
      branch: string | null;
      taskIds: string[];
    }>
  > {
    const worktreeBasePath = this.workspaceSettings.getWorktreeLocation();
    const twigWorktrees = await listTwigWorktrees(
      mainRepoPath,
      worktreeBasePath,
    );

    return twigWorktrees.map((wt) => ({
      worktreePath: wt.worktreePath,
      head: wt.head,
      branch: wt.branch,
      taskIds: this.getWorktreeTasks(wt.worktreePath).map((t) => t.taskId),
    }));
  }

  async deleteWorktree(
    mainRepoPath: string,
    worktreePath: string,
  ): Promise<void> {
    const worktree = this.worktreeRepo.findByPath(worktreePath);
    if (worktree) {
      const workspace = this.workspaceRepo.findById(worktree.workspaceId);
      if (workspace) {
        await this.deleteWorkspace(workspace.taskId, mainRepoPath);
        return;
      }
    }

    const worktreeBasePath = this.workspaceSettings.getWorktreeLocation();
    await deleteGitWorktree(mainRepoPath, worktreeBasePath, worktreePath);

    if (worktree) {
      this.worktreeRepo.deleteByWorkspaceId(worktree.workspaceId);
    }
  }

  private async cleanupWorktree(
    taskId: string,
    mainRepoPath: string,
    worktreePath: string,
    branchName: string | null,
  ): Promise<void> {
    try {
      await this.fileWatcher.stopWatching(worktreePath);
    } catch (error) {
      this.log.warn(
        `Failed to stop file watcher for worktree ${worktreePath}:`,
        error,
      );
    }

    try {
      const worktreeBasePath = this.workspaceSettings.getWorktreeLocation();
      await deleteGitWorktree(mainRepoPath, worktreeBasePath, worktreePath);
    } catch (error) {
      this.log.error(`Failed to delete worktree for task ${taskId}:`, error);
    }

    if (branchName) {
      try {
        const git = createGitClient(mainRepoPath);
        await git.deleteLocalBranch(branchName, true);
        this.log.info(`Deleted branch ${branchName} for task ${taskId}`);
      } catch (error) {
        this.log.warn(
          `Failed to delete branch ${branchName} for task ${taskId}:`,
          error,
        );
      }
    }
  }

  private emitWorkspaceError(taskId: string, message: string): void {
    this.emit(WorkspaceServiceEvent.Error, { taskId, message });
  }

  private emitWorkspaceWarning(
    taskId: string,
    title: string,
    message: string,
  ): void {
    this.emit(WorkspaceServiceEvent.Warning, { taskId, title, message });
  }
}
