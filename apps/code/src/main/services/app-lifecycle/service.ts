import {
  APP_LIFECYCLE_SERVICE,
  type IAppLifecycle,
} from "@posthog/platform/app-lifecycle";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { DATABASE_SERVICE } from "@posthog/workspace-server/db/identifiers";
import type { DatabaseService } from "@posthog/workspace-server/db/service";
import { PROCESS_TRACKING_SERVICE } from "@posthog/workspace-server/services/process-tracking/identifiers";
import type { ProcessTrackingService } from "@posthog/workspace-server/services/process-tracking/process-tracking";
import { SUSPENSION_SERVICE } from "@posthog/workspace-server/services/suspension/identifiers";
import type { SuspensionService } from "@posthog/workspace-server/services/suspension/suspension";
import type { WatcherRegistryService } from "@posthog/workspace-server/services/watcher-registry/watcher-registry";
import { inject, injectable } from "inversify";
import { WATCHER_REGISTRY_SERVICE } from "../../di/tokens";
import { posthogNodeAnalytics } from "../../platform-adapters/posthog-analytics";
import { withTimeout } from "../../utils/async";
import { logger } from "../../utils/logger";
import { shutdownOtelTransport } from "../../utils/otel-log-transport";

const log = logger.scope("app-lifecycle");

@injectable()
export class AppLifecycleService {
  private static readonly SHUTDOWN_TIMEOUT_MS = 3000;

  private _isQuittingForUpdate = false;
  private _isShuttingDown = false;

  constructor(
    @inject(APP_LIFECYCLE_SERVICE)
    private readonly appLifecycle: IAppLifecycle,
    @inject(DATABASE_SERVICE)
    private readonly db: DatabaseService,
    @inject(SUSPENSION_SERVICE)
    private readonly suspensionService: SuspensionService,
    @inject(WATCHER_REGISTRY_SERVICE)
    private readonly watcherRegistry: WatcherRegistryService,
    @inject(PROCESS_TRACKING_SERVICE)
    private readonly processTracking: ProcessTrackingService,
  ) {}

  get isQuittingForUpdate(): boolean {
    return this._isQuittingForUpdate;
  }

  get isShuttingDown(): boolean {
    return this._isShuttingDown;
  }

  setQuittingForUpdate(): void {
    this._isQuittingForUpdate = true;
  }

  clearQuittingForUpdate(): void {
    this._isQuittingForUpdate = false;
  }

  /**
   * Immediately kills the process. Used when shutdown is stuck or re-entrant.
   */
  forceKill(): never {
    log.warn("Force-killing process");
    process.exit(1);
  }

  /**
   * Full graceful shutdown with timeout. Force-kills if already in progress or times out.
   */
  async shutdown(): Promise<void> {
    if (this._isShuttingDown) {
      log.warn("Shutdown already in progress, forcing exit");
      this.forceKill();
    }

    this._isShuttingDown = true;

    const result = await withTimeout(
      this.doShutdown(),
      AppLifecycleService.SHUTDOWN_TIMEOUT_MS,
    );

    if (result.result === "timeout") {
      log.warn("Shutdown timeout reached, forcing exit", {
        timeoutMs: AppLifecycleService.SHUTDOWN_TIMEOUT_MS,
      });
      this.forceKill();
    }
  }

  /**
   * Tears down watchers and processes but keeps the DI container alive
   * so the before-quit handler can still access services. Used before quitAndInstall.
   */
  async shutdownWithoutContainer(): Promise<void> {
    log.info("Partial shutdown started (keeping container)");
    await this.teardownNativeResources();
    try {
      this.db.close();
    } catch (error) {
      log.warn("Failed to close database during partial shutdown", error);
    }
  }

  /**
   * Runs a full shutdown then exits the Electron app. The optional
   * `beforeExit` hook lets the composition root tear down the DI container
   * after shutdown completes but before the process exits.
   */
  async gracefulExit(beforeExit?: () => Promise<void>): Promise<void> {
    await this.shutdown();
    if (beforeExit) {
      await beforeExit();
    }
    this.appLifecycle.exit(0);
  }

  /**
   * Runs the full shutdown sequence: native resources, database, analytics.
   */
  private async doShutdown(): Promise<void> {
    log.info("Shutdown started");

    await this.teardownNativeResources();

    try {
      this.suspensionService.stopInactivityChecker();
    } catch (error) {
      log.warn("Failed to stop inactivity checker during shutdown", error);
    }

    try {
      this.db.close();
    } catch (error) {
      log.warn("Failed to close database during shutdown", error);
    }

    posthogNodeAnalytics.track(ANALYTICS_EVENTS.APP_QUIT);

    try {
      await shutdownOtelTransport();
    } catch (error) {
      log.warn("Failed to shutdown OTEL log transport", error);
    }

    try {
      await posthogNodeAnalytics.shutdown();
    } catch (error) {
      log.warn("Failed to shutdown PostHog", error);
    }

    log.info("Shutdown complete");
  }

  /**
   * Shuts down file watchers and kills child processes, then drains the
   * event loop so pending native callbacks fire while JS is still alive.
   */
  private async teardownNativeResources(): Promise<void> {
    try {
      await this.watcherRegistry.shutdownAll();
    } catch (error) {
      log.warn("Failed to shutdown watcher registry", error);
    }

    try {
      const snapshot = await this.processTracking.getSnapshot(true);
      log.debug("Process snapshot", {
        tracked: {
          shell: snapshot.tracked.shell.length,
          agent: snapshot.tracked.agent.length,
          child: snapshot.tracked.child.length,
        },
        discovered: snapshot.discovered?.length ?? 0,
      });

      const trackedCount =
        snapshot.tracked.shell.length +
        snapshot.tracked.agent.length +
        snapshot.tracked.child.length;

      if (trackedCount > 0) {
        log.info(`Killing ${trackedCount} tracked processes`);
        this.processTracking.killAll();
      }
    } catch (error) {
      log.warn("Failed to kill tracked processes", error);
    }

    // Drain pending native callbacks (e.g. @parcel/watcher ThreadSafeFunction)
    // so they fire while JS is still alive, not during FreeEnvironment teardown
    await new Promise((resolve) => setImmediate(resolve));
  }
}
