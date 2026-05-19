import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import * as watcher from "@parcel/watcher";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { WatcherRegistryService } from "../watcher-registry/service";
import {
  type DirectoryEntry,
  FileWatcherEvent,
  type FileWatcherEvents,
} from "./schemas";

const log = logger.scope("file-watcher");

const IGNORE_PATTERNS = ["**/node_modules/**", "**/.git/**", "**/.jj/**"];
const DEBOUNCE_MS = 500;
const BULK_THRESHOLD = 100;

interface PendingChanges {
  dirs: Set<string>;
  files: Set<string>;
  deletes: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

interface RepoWatcher {
  filesId: string;
  gitIds: string[];
  pending: PendingChanges;
}

@injectable()
export class FileWatcherService extends TypedEventEmitter<FileWatcherEvents> {
  private watchers = new Map<string, RepoWatcher>();

  constructor(
    @inject(MAIN_TOKENS.WatcherRegistryService)
    private watcherRegistry: WatcherRegistryService,
  ) {
    super();
  }

  async listDirectory(dirPath: string): Promise<DirectoryEntry[]> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries
        .filter((e) => !e.name.startsWith("."))
        .map((e) => ({
          name: e.name,
          path: path.join(dirPath, e.name),
          type: e.isDirectory() ? ("directory" as const) : ("file" as const),
        }))
        .sort((a, b) =>
          a.type !== b.type
            ? a.type === "directory"
              ? -1
              : 1
            : a.name.localeCompare(b.name),
        );
    } catch (error) {
      log.error("Failed to list directory:", error);
      return [];
    }
  }

  async startWatching(repoPath: string): Promise<void> {
    if (this.watchers.has(repoPath)) return;

    const pending: PendingChanges = {
      dirs: new Set(),
      files: new Set(),
      deletes: new Set(),
      timer: null,
    };

    const filesId = `file-watcher:files:${repoPath}`;

    const filesSub = await this.watchFiles(repoPath, pending);
    this.watcherRegistry.register(filesId, filesSub);

    const gitIds: string[] = [];
    const gitSubs = await this.watchGit(repoPath);
    if (gitSubs) {
      for (let i = 0; i < gitSubs.length; i++) {
        const gitId = `file-watcher:git:${repoPath}:${i}`;
        this.watcherRegistry.register(gitId, gitSubs[i]);
        gitIds.push(gitId);
      }
    }

    this.watchers.set(repoPath, {
      filesId,
      gitIds,
      pending,
    });
  }

  async stopWatching(repoPath: string): Promise<void> {
    const w = this.watchers.get(repoPath);
    if (!w) return;

    if (w.pending.timer) clearTimeout(w.pending.timer);
    await this.watcherRegistry.unregister(w.filesId);
    for (const gitId of w.gitIds) {
      await this.watcherRegistry.unregister(gitId);
    }
    this.watchers.delete(repoPath);
  }

  private async watchFiles(
    repoPath: string,
    pending: PendingChanges,
  ): Promise<watcher.AsyncSubscription> {
    return watcher.subscribe(
      repoPath,
      (err, events) => {
        if (this.watcherRegistry.isShutdown) return;
        if (err) {
          this.handleWatcherError(err, repoPath);
          return;
        }
        this.queueEvents(repoPath, pending, events);
      },
      { ignore: IGNORE_PATTERNS },
    );
  }

  private handleWatcherError(err: Error, repoPath: string): void {
    if (!existsSync(repoPath)) {
      log.info(`Directory deleted, stopping watcher: ${repoPath}`);
      this.stopWatching(repoPath).catch((e) =>
        log.warn(`Failed to stop watcher: ${e}`),
      );
    } else {
      log.debug("Watcher error:", err);
    }
  }

  private queueEvents(
    repoPath: string,
    pending: PendingChanges,
    events: watcher.Event[],
  ): void {
    for (const event of events) {
      pending.dirs.add(path.dirname(event.path));
      if (event.type === "delete") {
        pending.deletes.add(event.path);
      } else {
        pending.files.add(event.path);
      }
    }

    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(
      () => this.flushPending(repoPath, pending),
      DEBOUNCE_MS,
    );
  }

  private flushPending(repoPath: string, pending: PendingChanges): void {
    if (this.watcherRegistry.isShutdown) {
      pending.dirs.clear();
      pending.files.clear();
      pending.deletes.clear();
      pending.timer = null;
      return;
    }

    const totalChanges = pending.files.size + pending.deletes.size;

    // For bulk changes, emit a single event instead of per-file events
    if (totalChanges > BULK_THRESHOLD) {
      this.emit(FileWatcherEvent.GitStateChanged, { repoPath });
      pending.dirs.clear();
      pending.files.clear();
      pending.deletes.clear();
      pending.timer = null;
      return;
    }

    for (const dirPath of pending.dirs) {
      this.emit(FileWatcherEvent.DirectoryChanged, { repoPath, dirPath });
    }
    for (const filePath of pending.files) {
      this.emit(FileWatcherEvent.FileChanged, { repoPath, filePath });
    }
    for (const filePath of pending.deletes) {
      this.emit(FileWatcherEvent.FileDeleted, { repoPath, filePath });
    }

    pending.dirs.clear();
    pending.files.clear();
    pending.deletes.clear();
    pending.timer = null;
  }

  private async watchGit(
    repoPath: string,
  ): Promise<watcher.AsyncSubscription[] | null> {
    try {
      const gitDir = await this.resolveGitDir(repoPath);
      const subscriptions: watcher.AsyncSubscription[] = [];

      const handleEvents = (err: Error | null, events: watcher.Event[]) => {
        if (this.watcherRegistry.isShutdown) return;
        if (err) {
          log.error("Git watcher error:", err);
          return;
        }
        const isRelevant = events.some(
          (e) =>
            e.path.endsWith("/HEAD") ||
            e.path.endsWith("/index") ||
            e.path.includes("/refs/heads/"),
        );
        if (isRelevant) {
          this.emit(FileWatcherEvent.GitStateChanged, { repoPath });
        }
      };

      subscriptions.push(await watcher.subscribe(gitDir, handleEvents));

      const commonDir = await this.resolveCommonDir(gitDir);
      if (commonDir && commonDir !== gitDir) {
        subscriptions.push(await watcher.subscribe(commonDir, handleEvents));
      }

      return subscriptions;
    } catch (error) {
      log.warn("Failed to set up git watcher:", error);
      return null;
    }
  }

  private async resolveCommonDir(gitDir: string): Promise<string | null> {
    try {
      const commonDirFile = path.join(gitDir, "commondir");
      const content = await fs.readFile(commonDirFile, "utf-8");
      return path.resolve(gitDir, content.trim());
    } catch {
      return null;
    }
  }

  private async resolveGitDir(repoPath: string): Promise<string> {
    const gitPath = path.join(repoPath, ".git");
    const stat = await fs.stat(gitPath);

    if (stat.isDirectory()) return gitPath;

    const content = await fs.readFile(gitPath, "utf-8");
    const match = content.match(/gitdir:\s*(.+)/);
    if (!match) throw new Error("Invalid .git file format");
    return path.resolve(match[1].trim());
  }
}
