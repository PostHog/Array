import type { IAppLifecycle } from "@posthog/platform/app-lifecycle";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { inject, injectable } from "inversify";
import type { DatabaseService } from "../../db/service";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import { withTimeout } from "../../utils/async";
import { logger } from "../../utils/logger";
import { shutdownOtelTransport } from "../../utils/otel-log-transport";
import { shutdownPostHog, trackAppEvent } from "../posthog-analytics";
import type { ProcessTrackingService } from "../process-tracking/service";
import type { SuspensionService } from "../suspension/service.js";
import type { WatcherRegistryService } from "../watcher-registry/service";

const log = logger.scope("app-lifecycle");

@injectable()
export class AppLifecycleService {
  private static readonly SHUTDOWN_TIMEOUT_MS = 3000;

  private _isQuittingForUpdate = false;
  private _isShuttingDown = false;

  constructor(
    @inject(MAIN_TOKENS.AppLifecycle)
    private readonly appLifecycle: IAppLifecycle,
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
      const db = container.get<DatabaseService>(MAIN_TOKENS.DatabaseService);
      db.close();
    } catch (error) {
      log.warn("Failed to close database during partial shutdown", error);
    }
  }

  /**
   * Runs a full shutdown then exits the Electron app.
   */
  async gracefulExit(): Promise<void> {
    await this.shutdown();
    this.appLifecycle.exit(0);
  }

  /**
   * Runs the full shutdown sequence: native resources, container, analytics.
   */
  private async doShutdown(): Promise<void> {
    log.info("Shutdown started");

    await this.teardownNativeResources();

    try {
      const suspensionService = container.get<SuspensionService>(
        MAIN_TOKENS.SuspensionService,
      );
      suspensionService.stopInactivityChecker();
    } catch (error) {
      log.warn("Failed to stop inactivity checker during shutdown", error);
    }

    try {
      const db = container.get<DatabaseService>(MAIN_TOKENS.DatabaseService);
      db.close();
    } catch (error) {
      log.warn("Failed to close database during shutdown", error);
    }

    try {
      await container.unbindAll();
    } catch (error) {
      log.warn("Failed to unbind container", error);
    }

    trackAppEvent(ANALYTICS_EVENTS.APP_QUIT);

    try {
      await shutdownOtelTransport();
    } catch (error) {
      log.warn("Failed to shutdown OTEL log transport", error);
    }

    try {
      await shutdownPostHog();
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
      const watcherRegistry = container.get<WatcherRegistryService>(
        MAIN_TOKENS.WatcherRegistryService,
      );
      await watcherRegistry.shutdownAll();
    } catch (error) {
      log.warn("Failed to shutdown watcher registry", error);
    }

    try {
      const processTracking = container.get<ProcessTrackingService>(
        MAIN_TOKENS.ProcessTrackingService,
      );
      const snapshot = await processTracking.getSnapshot(true);
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
        processTracking.killAll();
      }
    } catch (error) {
      log.warn("Failed to kill tracked processes", error);
    }

    // Drain pending native callbacks (e.g. @parcel/watcher ThreadSafeFunction)
    // so they fire while JS is still alive, not during FreeEnvironment teardown
    await new Promise((resolve) => setImmediate(resolve));
  }
}
