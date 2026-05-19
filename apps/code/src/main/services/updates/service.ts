import type { IAppLifecycle } from "@posthog/platform/app-lifecycle";
import type { IAppMeta } from "@posthog/platform/app-meta";
import type { IMainWindow } from "@posthog/platform/main-window";
import type { IUpdater } from "@posthog/platform/updater";
import { inject, injectable, postConstruct, preDestroy } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { isDevBuild } from "../../utils/env";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { AppLifecycleService } from "../app-lifecycle/service";
import {
  type CheckForUpdatesOutput,
  type InstallUpdateOutput,
  UpdatesEvent,
  type UpdatesEvents,
  type UpdatesStatusPayload,
} from "./schemas";

type CheckSource = "user" | "periodic";

const log = logger.scope("updates");

@injectable()
export class UpdatesService extends TypedEventEmitter<UpdatesEvents> {
  private static readonly SERVER_HOST = "https://update.electronjs.org";
  private static readonly REPO_OWNER = "PostHog";
  private static readonly REPO_NAME = "code";
  private static readonly CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  private static readonly CHECK_TIMEOUT_MS = 60 * 1000; // 1 minute timeout for checks
  private static readonly DISABLE_ENV_FLAG = "ELECTRON_DISABLE_AUTO_UPDATE";
  private static readonly SUPPORTED_PLATFORMS = ["darwin", "win32"];

  @inject(MAIN_TOKENS.AppLifecycleService)
  private lifecycleService!: AppLifecycleService;

  @inject(MAIN_TOKENS.Updater)
  private updater!: IUpdater;

  @inject(MAIN_TOKENS.AppLifecycle)
  private appLifecycle!: IAppLifecycle;

  @inject(MAIN_TOKENS.AppMeta)
  private appMeta!: IAppMeta;

  @inject(MAIN_TOKENS.MainWindow)
  private mainWindow!: IMainWindow;

  private updateReady = false;
  private pendingNotification = false;
  private checkingForUpdates = false;
  private checkTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private checkIntervalId: ReturnType<typeof setInterval> | null = null;
  private downloadedVersion: string | null = null;
  private notifiedVersion: string | null = null;
  private initialized = false;
  private unsubscribes: Array<() => void> = [];

  get hasUpdateReady(): boolean {
    return this.updateReady;
  }

  get isEnabled(): boolean {
    return (
      this.updater.isSupported() &&
      !process.env[UpdatesService.DISABLE_ENV_FLAG] &&
      UpdatesService.SUPPORTED_PLATFORMS.includes(process.platform)
    );
  }

  private get feedUrl(): string {
    const ctor = this.constructor as typeof UpdatesService;
    return `${ctor.SERVER_HOST}/${ctor.REPO_OWNER}/${ctor.REPO_NAME}/${process.platform}-${process.arch}/${this.appMeta.version}`;
  }

  @postConstruct()
  init(): void {
    if (!this.isEnabled) {
      if (process.env[UpdatesService.DISABLE_ENV_FLAG]) {
        log.info("Auto updates disabled via environment flag");
      } else if (
        !UpdatesService.SUPPORTED_PLATFORMS.includes(process.platform)
      ) {
        log.info("Auto updates only supported on macOS and Windows");
      }
      return;
    }

    this.unsubscribes.push(
      this.mainWindow.onFocus(() => this.flushPendingNotification()),
    );
    this.appLifecycle.whenReady().then(() => this.setupAutoUpdater());
  }

  triggerMenuCheck(): void {
    this.emit(UpdatesEvent.CheckFromMenu, true);
  }

  checkForUpdates(source: CheckSource = "user"): CheckForUpdatesOutput {
    if (!this.isEnabled) {
      const reason = isDevBuild()
        ? "Updates only available in packaged builds"
        : "Auto updates only supported on macOS and Windows";
      return { success: false, errorMessage: reason, errorCode: "disabled" };
    }

    if (this.checkingForUpdates) {
      return {
        success: false,
        errorMessage: "Already checking for updates",
        errorCode: "already_checking",
      };
    }

    if (this.updateReady && source !== "periodic") {
      // User check: show the existing downloaded update notification
      log.info("Update already downloaded, showing prompt again", {
        downloadedVersion: this.downloadedVersion,
      });
      this.pendingNotification = true;
      this.flushPendingNotification();
      this.emitStatus({
        checking: false,
        updateReady: true,
        version: this.downloadedVersion ?? undefined,
      });
      return { success: true };
    }

    this.checkingForUpdates = true;
    this.emitStatus({ checking: true });
    this.performCheck();

    return { success: true };
  }

  async installUpdate(): Promise<InstallUpdateOutput> {
    if (!this.updateReady) {
      log.warn("installUpdate called but no update is ready");
      return { installed: false };
    }

    log.info("Installing update and restarting...", {
      downloadedVersion: this.downloadedVersion,
    });

    try {
      // Set the flag FIRST so before-quit handler won't prevent quit
      this.lifecycleService.setQuittingForUpdate();

      // Do lightweight cleanup: kill processes, shut down watchers
      // Skip container teardown so before-quit handler can still access services
      await this.lifecycleService.shutdownWithoutContainer();

      this.updater.quitAndInstall();
      return { installed: true };
    } catch (error) {
      log.error("Failed to quit and install update", error);
      return { installed: false };
    }
  }

  private setupAutoUpdater(): void {
    if (this.initialized) {
      log.warn("setupAutoUpdater called multiple times, ignoring");
      return;
    }

    this.initialized = true;
    const feedUrl = this.feedUrl;
    log.info("Setting up auto updater", {
      feedUrl,
      currentVersion: this.appMeta.version,
      platform: process.platform,
      arch: process.arch,
    });

    try {
      this.updater.setFeedUrl(feedUrl);
    } catch (error) {
      log.error("Failed to set feed URL", error);
      return;
    }

    this.unsubscribes.push(
      this.updater.onError((error) => this.handleError(error)),
      this.updater.onCheckStart(() => this.handleCheckingForUpdate()),
      this.updater.onUpdateAvailable(() => this.handleUpdateAvailable()),
      this.updater.onNoUpdate(() => this.handleNoUpdate()),
      this.updater.onUpdateDownloaded((releaseName) =>
        this.handleUpdateDownloaded(releaseName),
      ),
    );

    // Perform initial check (periodic source — not user-initiated)
    this.checkForUpdates("periodic");

    // Set up periodic checks
    this.checkIntervalId = setInterval(
      () => this.checkForUpdates("periodic"),
      UpdatesService.CHECK_INTERVAL_MS,
    );
  }

  private handleError(error: Error): void {
    this.clearCheckTimeout();
    log.error("Auto update error", {
      message: error.message,
      stack: error.stack,
      feedUrl: this.feedUrl,
    });

    // Reset checking state on error so user can retry
    if (this.checkingForUpdates) {
      this.checkingForUpdates = false;
      this.emitStatus({
        checking: false,
        error: error.message,
      });
    }
  }

  private handleCheckingForUpdate(): void {
    log.info("Checking for updates...");
  }

  private handleUpdateAvailable(): void {
    this.clearCheckTimeout();
    log.info("Update available, downloading...");
    // Keep checkingForUpdates true while downloading
    this.emitStatus({ checking: true, downloading: true });
  }

  private handleNoUpdate(): void {
    this.clearCheckTimeout();
    log.info("No updates available", { currentVersion: this.appMeta.version });
    if (this.checkingForUpdates) {
      this.checkingForUpdates = false;

      if (this.updateReady) {
        this.emitStatus({ checking: false });
        this.pendingNotification = true;
        this.flushPendingNotification();
      } else {
        this.emitStatus({
          checking: false,
          upToDate: true,
          version: this.appMeta.version,
        });
      }
    }
  }

  private handleUpdateDownloaded(releaseName?: string): void {
    this.clearCheckTimeout();
    const wasChecking = this.checkingForUpdates;
    this.checkingForUpdates = false;
    this.downloadedVersion = releaseName ?? null;

    if (wasChecking) {
      this.emitStatus({ checking: false });
    }

    log.info("Update downloaded, awaiting user confirmation", {
      currentVersion: this.appMeta.version,
      downloadedVersion: this.downloadedVersion,
    });

    this.updateReady = true;

    // Only show notification if this is a different version than already notified
    if (this.notifiedVersion !== this.downloadedVersion) {
      this.pendingNotification = true;
      this.flushPendingNotification();
    } else {
      log.info("Skipping notification — same version already notified", {
        version: this.downloadedVersion,
      });
    }
  }

  private flushPendingNotification(): void {
    if (this.updateReady && this.pendingNotification) {
      log.info("Notifying user that update is ready", {
        downloadedVersion: this.downloadedVersion,
      });
      this.emit(UpdatesEvent.Ready, { version: this.downloadedVersion });
      this.pendingNotification = false;
      this.notifiedVersion = this.downloadedVersion;
    }
  }

  private emitStatus(status: UpdatesStatusPayload): void {
    this.emit(UpdatesEvent.Status, status);
  }

  private performCheck(): void {
    // Clear any existing timeout
    this.clearCheckTimeout();

    // Set a timeout to reset the checking state if the check takes too long
    this.checkTimeoutId = setTimeout(() => {
      if (this.checkingForUpdates) {
        log.warn("Update check timed out after 60 seconds");
        this.checkingForUpdates = false;
        this.emitStatus({
          checking: false,
          error: "Update check timed out. Please try again.",
        });
      }
    }, UpdatesService.CHECK_TIMEOUT_MS);

    try {
      this.updater.check();
    } catch (error) {
      this.clearCheckTimeout();
      log.error("Failed to check for updates", error);
      this.checkingForUpdates = false;
      this.emitStatus({
        checking: false,
        error: "Failed to check for updates. Please try again.",
      });
    }
  }

  private clearCheckTimeout(): void {
    if (this.checkTimeoutId) {
      clearTimeout(this.checkTimeoutId);
      this.checkTimeoutId = null;
    }
  }

  @preDestroy()
  shutdown(): void {
    this.clearCheckTimeout();
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
  }
}
