import fs from "node:fs/promises";
import path from "node:path";
import * as watcher from "@parcel/watcher";
import {
  getStagedDiff,
  getUnstagedDiff,
  listUntrackedFiles,
} from "@posthog/git/queries";
import { ApplyPatchSaga } from "@posthog/git/sagas/patch";
import ignore, { type Ignore } from "ignore";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { subscribeWithTimeout } from "../../utils/async";
import { logger } from "../../utils/logger";
import type { WatcherRegistryService } from "../watcher-registry/service";

const log = logger.scope("focus-sync");

const DEBOUNCE_MS = 250;
const ALWAYS_IGNORE = [".git", ".jj", "node_modules"];

interface PendingSync {
  /** Files changed in main, need to sync to worktree */
  mainToWorktree: Map<string, "copy" | "delete">;
  /** Files changed in worktree, need to sync to main */
  worktreeToMain: Map<string, "copy" | "delete">;
  timer: ReturnType<typeof setTimeout> | null;
}

/** How long to ignore events for a file after we write it */
const WRITE_COOLDOWN_MS = 1000;

@injectable()
export class FocusSyncService {
  private mainRepoPath: string | null = null;
  private worktreePath: string | null = null;
  private mainWatcherId: string | null = null;
  private worktreeWatcherId: string | null = null;
  private gitignore!: Ignore;
  private pending: PendingSync = {
    mainToWorktree: new Map(),
    worktreeToMain: new Map(),
    timer: null,
  };
  private syncing = false;
  private initialSyncing = false;
  private currentSyncPromise: Promise<void> | null = null;

  private recentWrites: Map<string, number> = new Map();

  constructor(
    @inject(MAIN_TOKENS.WatcherRegistryService)
    private watcherRegistry: WatcherRegistryService,
  ) {}

  async startSync(mainRepoPath: string, worktreePath: string): Promise<void> {
    const [mainExists, worktreeExists] = await Promise.all([
      fs
        .access(mainRepoPath)
        .then(() => true)
        .catch(() => false),
      fs
        .access(worktreePath)
        .then(() => true)
        .catch(() => false),
    ]);

    if (!mainExists) {
      log.error(
        `Cannot start sync: main repo path does not exist: ${mainRepoPath}`,
      );
      return;
    }

    if (!worktreeExists) {
      log.error(
        `Cannot start sync: worktree path does not exist: ${worktreePath}`,
      );
      return;
    }

    if (this.mainWatcherId || this.worktreeWatcherId) {
      await this.stopSync();
    }

    this.mainRepoPath = mainRepoPath;
    this.worktreePath = worktreePath;

    await Promise.race([
      this.loadGitignore(mainRepoPath),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);

    this.initialSyncing = true;
    try {
      await this.copyUncommittedFiles(worktreePath, mainRepoPath);
    } catch (error) {
      log.warn("Initial sync failed:", error);
    } finally {
      this.initialSyncing = false;
    }

    const watcherIgnore = ALWAYS_IGNORE.map((p) => `**/${p}/**`);
    const mainWatcherId = `focus-sync:main:${mainRepoPath}`;
    const worktreeWatcherId = `focus-sync:worktree:${worktreePath}`;

    let mainRegistered = false;
    try {
      const mainSubPromise = watcher.subscribe(
        mainRepoPath,
        (err, events) => {
          if (!mainRegistered || this.watcherRegistry.isShutdown) return;
          if (err) {
            log.error("Main repo watcher error:", err);
            return;
          }
          this.handleEvents("main", events);
        },
        { ignore: watcherIgnore },
      );

      const mainSubResult = await subscribeWithTimeout(
        mainSubPromise,
        5000,
        mainWatcherId,
      );

      if (mainSubResult.result === "timeout") {
        log.warn("Main repo watcher subscription timed out");
      } else {
        mainRegistered = true;
        this.mainWatcherId = mainWatcherId;
        this.watcherRegistry.register(
          this.mainWatcherId,
          mainSubResult.subscription,
        );
      }
    } catch (error) {
      log.error("Failed to subscribe to main repo watcher:", error);
    }

    let worktreeRegistered = false;
    try {
      const worktreeSubPromise = watcher.subscribe(
        worktreePath,
        (err, events) => {
          if (!worktreeRegistered || this.watcherRegistry.isShutdown) return;
          if (err) {
            log.error("Worktree watcher error:", err);
            return;
          }
          this.handleEvents("worktree", events);
        },
        { ignore: watcherIgnore },
      );

      const worktreeSubResult = await subscribeWithTimeout(
        worktreeSubPromise,
        5000,
        worktreeWatcherId,
      );

      if (worktreeSubResult.result === "timeout") {
        log.warn("Worktree watcher subscription timed out");
      } else {
        worktreeRegistered = true;
        this.worktreeWatcherId = worktreeWatcherId;
        this.watcherRegistry.register(
          this.worktreeWatcherId,
          worktreeSubResult.subscription,
        );
      }
    } catch (error) {
      log.error("Failed to subscribe to worktree watcher:", error);
    }
  }

  async stopSync(): Promise<void> {
    if (this.pending.timer) {
      clearTimeout(this.pending.timer);
      this.pending.timer = null;
    }

    if (this.currentSyncPromise) {
      await Promise.race([
        this.currentSyncPromise,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    }

    if (
      this.pending.mainToWorktree.size > 0 ||
      this.pending.worktreeToMain.size > 0
    ) {
      await Promise.race([
        this.doFlush(),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    }

    if (this.mainWatcherId) {
      await this.watcherRegistry.unregister(this.mainWatcherId);
      this.mainWatcherId = null;
    }

    if (this.worktreeWatcherId) {
      await this.watcherRegistry.unregister(this.worktreeWatcherId);
      this.worktreeWatcherId = null;
    }

    this.mainRepoPath = null;
    this.worktreePath = null;
    this.pending.mainToWorktree.clear();
    this.pending.worktreeToMain.clear();
    this.recentWrites.clear();
    this.initialSyncing = false;
  }

  /**
   * Sync all uncommitted changes from source to destination using git diff/apply.
   * Preserves staged vs unstaged state. Handles deletes, renames, moves correctly.
   */
  async copyUncommittedFiles(srcPath: string, dstPath: string): Promise<void> {
    const [stagedPatch, unstagedPatch, untrackedList] = await Promise.all([
      getStagedDiff(srcPath).catch(() => ""),
      getUnstagedDiff(srcPath).catch(() => ""),
      listUntrackedFiles(srcPath).catch(() => []),
    ]);

    const hasStaged = stagedPatch.length > 0;
    const hasUnstaged = unstagedPatch.length > 0;
    const hasUntracked = untrackedList.length > 0;

    if (!hasStaged && !hasUnstaged && !hasUntracked) {
      return;
    }

    log.info(
      `Syncing changes: staged=${hasStaged}, unstaged=${hasUnstaged}, untracked=${untrackedList.length} files`,
    );

    if (hasStaged) {
      try {
        await this.applyPatch(dstPath, stagedPatch, true);
      } catch (error) {
        log.warn("Failed to apply staged changes:", error);
      }
    }

    if (hasUnstaged) {
      try {
        await this.applyPatch(dstPath, unstagedPatch, false);
      } catch (error) {
        log.warn("Failed to apply unstaged changes:", error);
      }
    }

    if (hasUntracked) {
      for (const file of untrackedList) {
        const src = path.join(srcPath, file);
        const dst = path.join(dstPath, file);
        await this.copyFileDirect(src, dst);
      }
    }
  }

  private async applyPatch(
    repoPath: string,
    patch: string,
    cached: boolean,
  ): Promise<void> {
    const saga = new ApplyPatchSaga();
    const result = await saga.run({ baseDir: repoPath, patch, cached });
    if (!result.success) {
      throw new Error(`git apply failed: ${result.error}`);
    }
  }

  private async copyFileDirect(
    srcPath: string,
    dstPath: string,
  ): Promise<void> {
    try {
      const srcStat = await fs.stat(srcPath);
      if (!srcStat.isFile()) return;

      await fs.mkdir(path.dirname(dstPath), { recursive: true });
      await fs.copyFile(srcPath, dstPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn(`Failed to copy file: ${srcPath}`, error);
      }
    }
  }

  private async loadGitignore(repoPath: string): Promise<void> {
    this.gitignore = ignore().add(ALWAYS_IGNORE);

    try {
      const content = await fs.readFile(
        path.join(repoPath, ".gitignore"),
        "utf-8",
      );
      this.gitignore.add(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  private handleEvents(
    source: "main" | "worktree",
    events: watcher.Event[],
  ): void {
    if (this.initialSyncing) return;

    const basePath = source === "main" ? this.mainRepoPath : this.worktreePath;
    if (!basePath) return;

    const pendingMap =
      source === "main"
        ? this.pending.mainToWorktree
        : this.pending.worktreeToMain;

    const now = Date.now();

    for (const event of events) {
      const relativePath = path.relative(basePath, event.path);

      // Skip ignored files
      if (this.gitignore.ignores(relativePath)) {
        continue;
      }

      // Skip files we recently wrote (prevents sync loops)
      const lastWrite = this.recentWrites.get(event.path);
      if (lastWrite && now - lastWrite < WRITE_COOLDOWN_MS) {
        continue;
      }

      if (event.type === "delete") {
        pendingMap.set(relativePath, "delete");
      } else {
        // create or update
        pendingMap.set(relativePath, "copy");
      }
    }

    // Schedule flush
    if (this.pending.timer) {
      clearTimeout(this.pending.timer);
    }
    this.pending.timer = setTimeout(() => this.flushPending(), DEBOUNCE_MS);
  }

  private async flushPending(): Promise<void> {
    if (this.syncing) {
      // Already syncing, reschedule
      this.pending.timer = setTimeout(() => this.flushPending(), DEBOUNCE_MS);
      return;
    }

    this.currentSyncPromise = this.doFlush();
    await this.currentSyncPromise;
    this.currentSyncPromise = null;
  }

  private async doFlush(): Promise<void> {
    this.syncing = true;
    this.pending.timer = null;

    try {
      // Process main -> worktree
      if (this.pending.mainToWorktree.size > 0) {
        const ops = new Map(this.pending.mainToWorktree);
        this.pending.mainToWorktree.clear();
        await this.syncFiles("main", ops);
      }

      // Process worktree -> main
      if (this.pending.worktreeToMain.size > 0) {
        const ops = new Map(this.pending.worktreeToMain);
        this.pending.worktreeToMain.clear();
        await this.syncFiles("worktree", ops);
      }
    } finally {
      this.syncing = false;
    }
  }

  private async syncFiles(
    source: "main" | "worktree",
    operations: Map<string, "copy" | "delete">,
  ): Promise<void> {
    const srcBase = source === "main" ? this.mainRepoPath : this.worktreePath;
    const dstBase = source === "main" ? this.worktreePath : this.mainRepoPath;

    if (!srcBase || !dstBase) return;

    for (const [relativePath, op] of operations) {
      const srcPath = path.join(srcBase, relativePath);
      const dstPath = path.join(dstBase, relativePath);

      if (op === "delete") {
        await this.deleteFile(dstPath);
      } else {
        await this.copyFile(srcPath, dstPath);
      }
    }
  }

  private async copyFile(srcPath: string, dstPath: string): Promise<void> {
    let srcStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      srcStat = await fs.stat(srcPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        log.debug(`Source file no longer exists, skipping: ${srcPath}`);
        return;
      }
      throw error;
    }

    if (!srcStat.isFile()) {
      return;
    }

    try {
      const [srcContent, dstContent] = await Promise.all([
        fs.readFile(srcPath),
        fs.readFile(dstPath),
      ]);

      if (srcContent.equals(dstContent)) {
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    await fs.mkdir(path.dirname(dstPath), { recursive: true });
    this.recentWrites.set(dstPath, Date.now());
    await fs.copyFile(srcPath, dstPath);
  }

  private async deleteFile(filePath: string): Promise<void> {
    this.recentWrites.set(filePath, Date.now());

    try {
      await fs.rm(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}
