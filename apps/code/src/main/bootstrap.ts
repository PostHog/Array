/**
 * Bootstrap entry point — the single place that knows about electron AND the
 * env-var boundary used by utility singletons.
 *
 * Runs BEFORE any service / util is imported. Sets:
 *   1. app name + custom userData path (needed for single-instance lock, stores, etc.)
 *   2. env vars that utility singletons (utils/logger, utils/env, utils/store,
 *      utils/fixPath, utils/otel-log-transport, services/settingsStore) read
 *      at module load. These utils do NOT import from "electron" — they only
 *      read from process.env, which keeps them portable.
 *
 * Static import of utils/fixPath is safe because fixPath reads process.env at
 * CALL time, not at module load. The main app body loads via dynamic
 * `import("./index.js")` so env vars are guaranteed to be set first.
 */

import dns from "node:dns";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, crashReporter, protocol } from "electron";
import { fixPath } from "./utils/fixPath";

const isDev = !app.isPackaged;

// Set app name for single-instance lock, crashReporter, etc
const appName = isDev ? "posthog-code-dev" : "posthog-code";
app.setName(isDev ? "PostHog Code (Development)" : "PostHog Code");

// Set userData path for @posthog/code
const appDataPath = app.getPath("appData");
const userDataPath = path.join(appDataPath, "@posthog", appName);
app.setPath("userData", userDataPath);

// Export the electron-derived state to env so utility singletons (utils/*,
// services/settingsStore) can read it without importing from "electron".
// MUST happen before any project module evaluates code that reads these.
process.env.POSTHOG_CODE_DATA_DIR = userDataPath;
process.env.POSTHOG_CODE_IS_DEV = String(isDev);
process.env.POSTHOG_CODE_VERSION = app.getVersion();

// Enable Chromium internal logging to a dedicated file. Without this, Chromium
// crashes (black screens, render-process-gone, GPU process death) leave no
// trail because Electron silently swallows the underlying logs. Must run
// before app.whenReady() so the switches take effect on the GPU/renderer
// child processes.
const chromiumLogDir = path.join(
  os.homedir(),
  ".posthog-code",
  isDev ? "logs-dev" : "logs",
);
mkdirSync(chromiumLogDir, { recursive: true });
const chromiumLogPath = path.join(chromiumLogDir, "chromium.log");
process.env.ELECTRON_ENABLE_LOGGING = "1";
process.env.POSTHOG_CODE_CHROMIUM_LOG_PATH = chromiumLogPath;
app.commandLine.appendSwitch("enable-logging", "file");
app.commandLine.appendSwitch("log-file", chromiumLogPath);
app.commandLine.appendSwitch("log-level", "0");

crashReporter.start({ uploadToServer: false });

// Force IPv4 resolution when "localhost" is used so the agent hits 127.0.0.1
// instead of ::1. This matches how the renderer already reaches the PostHog API.
dns.setDefaultResultOrder("ipv4first");

// Call fixPath early to ensure PATH is correct for any child processes
fixPath();

// Register mcp-sandbox: protocol scheme for MCP Apps iframe isolation.
// Must be called before app.ready — gives the sandbox proxy its own origin
// so MCP Apps can't access the renderer's DOM, storage, or cookies.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "mcp-sandbox",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

// Now dynamically import the rest of the application.
// Dynamic import ensures env vars are set BEFORE index.js is evaluated —
// static imports are hoisted and would run before our process.env writes.
import("./index.js");
