import "reflect-metadata";
import os from "node:os";
import { app, BrowserWindow } from "electron";
import log from "electron-log/main";
import "./utils/logger";
import "./services/index.js";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import type { DatabaseService } from "./db/service";
import { initializeDeepLinks, registerDeepLinkHandlers } from "./deep-links";
import { container } from "./di/container";
import { MAIN_TOKENS } from "./di/tokens";
import { registerMcpSandboxProtocol } from "./protocols/mcp-sandbox";
import type { AppLifecycleService } from "./services/app-lifecycle/service";
import type { AuthService } from "./services/auth/service";
import type { ExternalAppsService } from "./services/external-apps/service";
import type { GitHubIntegrationService } from "./services/github-integration/service";
import type { InboxLinkService } from "./services/inbox-link/service";
import type { NotificationService } from "./services/notification/service";
import type { OAuthService } from "./services/oauth/service";
import {
  captureException,
  getPostHogClient,
  initializePostHog,
  trackAppEvent,
} from "./services/posthog-analytics";
import type { PosthogPluginService } from "./services/posthog-plugin/service";
import type { SuspensionService } from "./services/suspension/service";
import type { TaskLinkService } from "./services/task-link/service";
import type { UpdatesService } from "./services/updates/service";
import type { WorkspaceService } from "./services/workspace/service";
import { ensureClaudeConfigDir } from "./utils/env";
import {
  getChromiumLogFilePath,
  getLogFilePath,
  readChromiumLogTail,
} from "./utils/logger";
import { createWindow } from "./window";

// Single instance lock must be acquired FIRST before any other app setup
const additionalData = process.defaultApp ? { argv: process.argv } : undefined;
const gotTheLock = app.requestSingleInstanceLock(additionalData);
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

const RECOVERABLE_RENDER_REASONS = new Set([
  "abnormal-exit",
  "killed",
  "crashed",
  "oom",
  "integrity-failure",
  "memory-eviction",
]);
const CRASH_LOOP_WINDOW_MS = 30_000;
const CRASH_LOOP_THRESHOLD = 3;
const recentCrashTimestamps: number[] = [];

function isCrashLoop(): boolean {
  const now = Date.now();
  while (
    recentCrashTimestamps.length > 0 &&
    now - recentCrashTimestamps[0] > CRASH_LOOP_WINDOW_MS
  ) {
    recentCrashTimestamps.shift();
  }
  recentCrashTimestamps.push(now);
  return recentCrashTimestamps.length >= CRASH_LOOP_THRESHOLD;
}

app.on("render-process-gone", (_event, webContents, details) => {
  const props = {
    source: "main",
    type: "render-process-gone",
    reason: details.reason,
    exitCode: String(details.exitCode),
    url: webContents.getURL(),
    title: webContents.getTitle(),
    webContentsId: String(webContents.id),
  };
  log.error("Renderer process gone", {
    ...props,
    chromiumLogTail: readChromiumLogTail(),
  });
  captureException(
    new Error(`Renderer process gone: ${details.reason}`),
    props,
  );
  getPostHogClient()
    ?.flush()
    .catch(() => {});

  if (RECOVERABLE_RENDER_REASONS.has(details.reason)) {
    if (isCrashLoop()) {
      log.error("Crash loop detected, stopping auto-recovery", {
        crashesInWindow: recentCrashTimestamps.length,
        windowMs: CRASH_LOOP_WINDOW_MS,
      });
      return;
    }
    log.info("Recovering from renderer crash", { reason: details.reason });
    const win = BrowserWindow.fromWebContents(webContents);
    if (!win || win.isDestroyed()) {
      log.warn("No window to recover");
      return;
    }
    setImmediate(() => {
      if (win.isDestroyed()) return;
      log.info("Reloading webContents");
      win.webContents.reload();
      log.info("Bringing window to foreground");
      win.show();
      win.moveTop();
      win.focus();
      app.focus({ steal: true });
    });
  }
});

app.on("child-process-gone", (_event, details) => {
  const props = {
    source: "main",
    type: "child-process-gone",
    processType: details.type,
    reason: details.reason,
    exitCode: String(details.exitCode),
    serviceName: details.serviceName ?? "",
    name: details.name ?? "",
  };
  log.error("Child process gone", {
    ...props,
    chromiumLogTail: readChromiumLogTail(),
  });
  captureException(
    new Error(`Child process gone (${details.type}): ${details.reason}`),
    props,
  );
  getPostHogClient()
    ?.flush()
    .catch(() => {});
});

async function initializeServices(): Promise<void> {
  container.get<DatabaseService>(MAIN_TOKENS.DatabaseService);
  container.get<OAuthService>(MAIN_TOKENS.OAuthService);
  const authService = container.get<AuthService>(MAIN_TOKENS.AuthService);
  container.get<NotificationService>(MAIN_TOKENS.NotificationService);
  container.get<UpdatesService>(MAIN_TOKENS.UpdatesService);
  container.get<TaskLinkService>(MAIN_TOKENS.TaskLinkService);
  container.get<InboxLinkService>(MAIN_TOKENS.InboxLinkService);
  container.get<GitHubIntegrationService>(MAIN_TOKENS.GitHubIntegrationService);
  container.get<ExternalAppsService>(MAIN_TOKENS.ExternalAppsService);
  container.get<PosthogPluginService>(MAIN_TOKENS.PosthogPluginService);

  await authService.initialize();

  // Initialize workspace branch watcher for live branch rename detection
  const workspaceService = container.get<WorkspaceService>(
    MAIN_TOKENS.WorkspaceService,
  );
  workspaceService.initBranchWatcher();

  const suspensionService = container.get<SuspensionService>(
    MAIN_TOKENS.SuspensionService,
  );
  suspensionService.startInactivityChecker();

  // Track app started event
  trackAppEvent(ANALYTICS_EVENTS.APP_STARTED);
}

// ========================================================
// App lifecycle
// ========================================================

// Register deep link handlers
registerDeepLinkHandlers();

// Initialize PostHog analytics
initializePostHog();

app.whenReady().then(async () => {
  const commit = __BUILD_COMMIT__ ?? "dev";
  const buildDate = __BUILD_DATE__ ?? "dev";
  log.info(
    [
      `PostHog Code electron v${app.getVersion()} booting up`,
      `Commit: ${commit}`,
      `Date: ${buildDate}`,
      `Electron: ${process.versions.electron}`,
      `Chromium: ${process.versions.chrome}`,
      `Node.js: ${process.versions.node}`,
      `V8: ${process.versions.v8}`,
      `OS: ${process.platform} ${process.arch} ${os.release()}`,
    ].join(" | "),
  );
  log.info(
    `Logs: main=${getLogFilePath()} chromium=${getChromiumLogFilePath() ?? "(disabled)"}`,
  );
  ensureClaudeConfigDir();
  registerMcpSandboxProtocol();
  createWindow();
  await initializeServices();
  initializeDeepLinks();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", async (event) => {
  let lifecycleService: AppLifecycleService;
  try {
    lifecycleService = container.get<AppLifecycleService>(
      MAIN_TOKENS.AppLifecycleService,
    );
  } catch {
    // Container already torn down (e.g. second quit during shutdown), let Electron quit
    return;
  }

  // If quitting to install an update, don't block and let the updater handle it
  // we already gracefully shutdown the app in the updates service when the update is ready
  if (lifecycleService.isQuittingForUpdate) {
    return;
  }

  // If shutdown is already in progress, force-kill immediately
  if (lifecycleService.isShuttingDown) {
    lifecycleService.forceKill();
  }

  event.preventDefault();

  await lifecycleService.gracefulExit();
});

const handleShutdownSignal = async (signal: string) => {
  log.info(`Received ${signal}, starting shutdown`);
  try {
    const lifecycleService = container.get<AppLifecycleService>(
      MAIN_TOKENS.AppLifecycleService,
    );
    if (lifecycleService.isShuttingDown) {
      log.warn(`${signal} received during shutdown, forcing exit`);
      process.exit(1);
    }
    await lifecycleService.shutdown();
  } catch (_err) {
    // Container torn down or shutdown failed
  }
  process.exit(0);
};

// ========================================================
// Process signal handlers
// ========================================================

process.on("SIGTERM", () => handleShutdownSignal("SIGTERM"));
process.on("SIGINT", () => handleShutdownSignal("SIGINT"));
if (process.platform !== "win32") {
  process.on("SIGHUP", () => handleShutdownSignal("SIGHUP"));
}

process.on("uncaughtException", (error) => {
  if (error.message === "write EIO") {
    log.transports.console.level = false;
    return;
  }
  log.error("Uncaught exception", error);
  captureException(error, { source: "main", type: "uncaughtException" });
});

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection", reason);
  const error = reason instanceof Error ? reason : new Error(String(reason));
  captureException(error, { source: "main", type: "unhandledRejection" });
});
