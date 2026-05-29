import type { IAppLifecycle } from "@posthog/platform/app-lifecycle";
import type { IAppMeta } from "@posthog/platform/app-meta";
import type { IMainWindow } from "@posthog/platform/main-window";
import type { IUpdater } from "@posthog/platform/updater";
import { inject, injectable, postConstruct, preDestroy } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { withTimeout } from "../../utils/async";
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
type UpdateState =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "installing"
  | "error";
type TransitionContext = {
  source?: CheckSource;
  skippedBecauseUpdateStaged?: boolean;
  reason?: string;
  incomingVersion?: string | null;
  error?: string;
};

const log = logger.scope("updates");

@injectable()
export class UpdatesService extends TypedEventEmitter<UpdatesEvents> {
  private static readonly SERVER_HOST = "https://update.electronjs.org";
  private static readonly REPO_OWNER = "PostHog";
  private static readonly REPO_NAME = "code";
  private static readonly CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  private static readonly CHECK_TIMEOUT_MS = 60 * 1000; // 1 minute timeout for checks
  private static readonly INSTALL_SHUTDOWN_TIMEOUT_MS = 3000;
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

  private state: UpdateState = "idle";
  private pendingNotification = false;
  private checkTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private checkIntervalId: ReturnType<typeof setInterval> | null = null;
  private downloadedVersion: string | null = null;
  private notifiedVersion: string | null = null;
  private lastError: string | null = null;
  private initialized = false;
  private unsubscribes: Array<() => void> = [];

  get hasUpdateReady(): boolean {
    return this.isUpdateStaged();
  }

  private isUpdateStaged(): boolean {
    return this.state === "ready" || this.state === "installing";
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

  getStatus(): UpdatesStatusPayload {
    if (this.state === "checking") {
      return { checking: true };
    }

    if (this.state === "downloading") {
      return { checking: true, downloading: true };
    }

    if (this.isUpdateStaged()) {
      return this.stagedStatusPayload();
    }

    if (this.state === "error") {
      return {
        checking: false,
        error: this.lastError ?? "Update check failed. Please try again.",
      };
    }

    return { checking: false };
  }

  checkForUpdates(source: CheckSource = "user"): CheckForUpdatesOutput {
    if (!this.isEnabled) {
      const reason = isDevBuild()
        ? "Updates only available in packaged builds"
        : "Auto updates only supported on macOS and Windows";
      return { success: false, errorMessage: reason, errorCode: "disabled" };
    }

    if (this.isUpdateStaged()) {
      this.logStateTransition(this.state, {
        source,
        skippedBecauseUpdateStaged: true,
        reason: "check skipped because update is already staged",
      });

      if (source === "user") {
        this.pendingNotification = true;
        this.flushPendingNotification();
        this.emitStatus(this.stagedStatusPayload());
      }

      return { success: true };
    }

    if (this.state === "checking" || this.state === "downloading") {
      return {
        success: false,
        errorMessage: "Already checking for updates",
        errorCode: "already_checking",
      };
    }

    this.transitionTo("checking", { source });
    this.emitStatus({ checking: true });
    this.performCheck();

    return { success: true };
  }

  async installUpdate(): Promise<InstallUpdateOutput> {
    if (this.state === "installing") {
      this.logStateTransition("installing", {
        skippedBecauseUpdateStaged: true,
        reason: "install already in progress",
      });
      return { installed: true };
    }

    if (this.state !== "ready") {
      log.warn("installUpdate called but no update is ready", {
        state: this.state,
      });
      return { installed: false };
    }

    log.info("Installing update and restarting...", {
      downloadedVersion: this.downloadedVersion,
    });

    try {
      this.transitionTo("installing", { reason: "install requested" });
      this.emitStatus(this.stagedStatusPayload());
      this.lifecycleService.setQuittingForUpdate();
      const cleanupResult = await withTimeout(
        this.lifecycleService.shutdownWithoutContainer(),
        UpdatesService.INSTALL_SHUTDOWN_TIMEOUT_MS,
      );
      if (cleanupResult.result === "timeout") {
        log.warn("Partial shutdown timed out before update install", {
          timeoutMs: UpdatesService.INSTALL_SHUTDOWN_TIMEOUT_MS,
          downloadedVersion: this.downloadedVersion,
        });
      }
      this.updater.quitAndInstall();
      return { installed: true };
    } catch (error) {
      log.error("Failed to quit and install update", error);
      this.lifecycleService.clearQuittingForUpdate();
      this.transitionTo("ready", {
        reason: "install handoff failed",
        error: error instanceof Error ? error.message : String(error),
      });
      this.emitStatus(this.stagedStatusPayload());
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
      this.updater.onCheckStart(() => log.info("Checking for updates...")),
      this.updater.onUpdateAvailable(() => this.handleUpdateAvailable()),
      this.updater.onNoUpdate(() => this.handleNoUpdate()),
      this.updater.onUpdateDownloaded((releaseName) =>
        this.handleUpdateDownloaded(releaseName),
      ),
    );

    this.checkForUpdates("periodic");

    this.checkIntervalId = setInterval(
      () => this.checkForUpdates("periodic"),
      UpdatesService.CHECK_INTERVAL_MS,
    );
  }

  private stagedStatusPayload(): UpdatesStatusPayload {
    return {
      checking: false,
      updateReady: true,
      installing: this.state === "installing",
      version: this.downloadedVersion ?? undefined,
    };
  }

  private handleError(error: Error): void {
    this.clearCheckTimeout();
    log.error("Auto update error", {
      message: error.message,
      stack: error.stack,
      feedUrl: this.feedUrl,
      state: this.state,
    });

    if (this.isUpdateStaged()) {
      this.logStateTransition(this.state, {
        skippedBecauseUpdateStaged: true,
        reason: "updater error ignored because update is staged",
        error: error.message,
      });
      return;
    }

    if (this.state === "checking" || this.state === "downloading") {
      this.lastError = error.message;
      this.transitionTo("error", { error: error.message });
      this.emitStatus({
        checking: false,
        error: error.message,
      });
    }
  }

  private handleUpdateAvailable(): void {
    if (this.isUpdateStaged()) {
      log.info(
        "Ignoring update-available because an update is already staged",
        {
          downloadedVersion: this.downloadedVersion,
        },
      );
      return;
    }

    this.clearCheckTimeout();
    this.transitionTo("downloading", { reason: "update available" });
    log.info("Update available, downloading...");
    this.emitStatus({ checking: true, downloading: true });
  }

  private handleNoUpdate(): void {
    this.clearCheckTimeout();

    if (this.isUpdateStaged()) {
      log.info("Ignoring update-not-available because update is staged", {
        downloadedVersion: this.downloadedVersion,
      });
      return;
    }

    log.info("No updates available", { currentVersion: this.appMeta.version });
    if (this.state === "checking" || this.state === "downloading") {
      this.transitionTo("idle", { reason: "no update available" });
      this.emitStatus({
        checking: false,
        upToDate: true,
        version: this.appMeta.version,
      });
    }
  }

  private handleUpdateDownloaded(releaseName?: string): void {
    this.clearCheckTimeout();

    if (this.isUpdateStaged()) {
      log.info("Ignoring duplicate update-downloaded event", {
        existingVersion: this.downloadedVersion,
        incomingVersion: releaseName,
      });
      return;
    }

    this.downloadedVersion = releaseName ?? null;
    this.transitionTo("ready", {
      reason: "update downloaded",
      incomingVersion: releaseName ?? null,
    });
    this.clearCheckInterval();
    this.emitStatus(this.stagedStatusPayload());

    log.info("Update downloaded, awaiting user confirmation", {
      currentVersion: this.appMeta.version,
      downloadedVersion: this.downloadedVersion,
    });

    if (this.notifiedVersion !== this.downloadedVersion) {
      this.pendingNotification = true;
      this.flushPendingNotification();
    } else {
      log.info("Skipping notification - same version already notified", {
        version: this.downloadedVersion,
      });
    }
  }

  private flushPendingNotification(): void {
    if (this.state === "ready" && this.pendingNotification) {
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
    this.clearCheckTimeout();

    this.checkTimeoutId = setTimeout(() => {
      if (this.state === "checking" || this.state === "downloading") {
        const timeoutSeconds = UpdatesService.CHECK_TIMEOUT_MS / 1000;
        const message = "Update check timed out. Please try again.";
        log.warn(`Update check timed out after ${timeoutSeconds} seconds`);
        this.lastError = message;
        this.transitionTo("error", { error: message });
        this.emitStatus({ checking: false, error: message });
      }
    }, UpdatesService.CHECK_TIMEOUT_MS);

    try {
      this.updater.check();
    } catch (error) {
      this.clearCheckTimeout();
      log.error("Failed to check for updates", error);
      this.lastError = "Failed to check for updates. Please try again.";
      this.transitionTo("error", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.emitStatus({
        checking: false,
        error: "Failed to check for updates. Please try again.",
      });
    }
  }

  private transitionTo(
    state: UpdateState,
    context: TransitionContext = {},
  ): void {
    this.logStateTransition(state, context);
    this.state = state;
    if (state !== "error") {
      this.lastError = null;
    }
  }

  private logStateTransition(
    toState: UpdateState,
    context: TransitionContext = {},
  ): void {
    log.info("Update state transition", {
      source: context.source,
      fromState: this.state,
      toState,
      downloadedVersion: this.downloadedVersion,
      skippedBecauseUpdateStaged: context.skippedBecauseUpdateStaged ?? false,
      reason: context.reason,
      incomingVersion: context.incomingVersion,
      error: context.error,
    });
  }

  private clearCheckTimeout(): void {
    if (this.checkTimeoutId) {
      clearTimeout(this.checkTimeoutId);
      this.checkTimeoutId = null;
    }
  }

  private clearCheckInterval(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }
  }

  @preDestroy()
  shutdown(): void {
    this.clearCheckTimeout();
    this.clearCheckInterval();
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
  }
}
