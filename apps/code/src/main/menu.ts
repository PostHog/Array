import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  type MenuItemConstructorOptions,
  shell,
} from "electron";
import { container } from "./di/container";
import { MAIN_TOKENS } from "./di/tokens";
import type { AuthService } from "./services/auth/service";
import type { McpAppsService } from "./services/mcp-apps/service";
import type { UIService } from "./services/ui/service";
import type { UpdatesService } from "./services/updates/service";
import { isDevBuild } from "./utils/env";
import { getLogFilePath } from "./utils/logger";

function findLatestCrashDump(): string | null {
  const pendingDir = path.join(app.getPath("crashDumps"), "pending");
  let entries: string[];
  try {
    entries = readdirSync(pendingDir);
  } catch {
    return null;
  }
  let latest: { file: string; mtimeMs: number } | null = null;
  for (const name of entries) {
    if (!name.endsWith(".dmp")) continue;
    const full = path.join(pendingDir, name);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(full).mtimeMs;
    } catch {
      continue;
    }
    if (!latest || mtimeMs > latest.mtimeMs) {
      latest = { file: full, mtimeMs };
    }
  }
  return latest?.file ?? null;
}

function getSystemInfo(): string {
  const commit = __BUILD_COMMIT__ ?? "dev";
  const buildDate = __BUILD_DATE__ ?? "dev";
  return [
    `Version: ${app.getVersion()}`,
    `Commit: ${commit}`,
    `Date: ${buildDate}`,
    `Electron: ${process.versions.electron}`,
    `Chromium: ${process.versions.chrome}`,
    `Node.js: ${process.versions.node}`,
    `V8: ${process.versions.v8}`,
    `OS: ${process.platform} ${process.arch} ${os.release()}`,
  ].join("\n");
}

export function buildApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    buildAppMenu(),
    buildFileMenu(),
    buildEditMenu(),
    buildViewMenu(),
    buildWindowMenu(),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildAppMenu(): MenuItemConstructorOptions {
  return {
    label: "PostHog Code",
    submenu: [
      {
        label: "About PostHog Code",
        click: () => {
          const info = getSystemInfo();

          dialog
            .showMessageBox({
              type: "info",
              title: "About PostHog Code",
              message: "PostHog Code",
              detail: info,
              buttons: ["Copy", "OK"],
              defaultId: 1,
            })
            .then((result) => {
              if (result.response === 0) {
                clipboard.writeText(info);
              }
            });
        },
      },
      { type: "separator" },
      {
        label: "Settings...",
        accelerator: "CmdOrCtrl+,",
        click: () => {
          container.get<UIService>(MAIN_TOKENS.UIService).openSettings();
        },
      },
      { type: "separator" },
      ...(!isDevBuild()
        ? [
            {
              label: "Check for Updates...",
              click: () => {
                container
                  .get<UpdatesService>(MAIN_TOKENS.UpdatesService)
                  .triggerMenuCheck();
              },
            },
            { type: "separator" as const },
          ]
        : []),
      { role: "hide" as const },
      { role: "hideOthers" as const },
      { role: "unhide" as const },
      { type: "separator" as const },
      { role: "quit" as const },
    ],
  };
}

function buildFileMenu(): MenuItemConstructorOptions {
  return {
    label: "File",
    submenu: [
      {
        label: "New task",
        accelerator: "CmdOrCtrl+N",
        click: () => {
          container.get<UIService>(MAIN_TOKENS.UIService).newTask();
        },
      },
      { type: "separator" },
      {
        label: "Developer",
        submenu: [
          {
            label:
              process.platform === "darwin"
                ? "Show log file in Finder"
                : "Show log file in file manager",
            click: () => {
              shell.showItemInFolder(getLogFilePath());
            },
          },
          {
            label:
              process.platform === "darwin"
                ? "Show crash dumps in Finder"
                : "Show crash dumps in file manager",
            click: () => {
              const latest = findLatestCrashDump();
              if (latest) {
                shell.showItemInFolder(latest);
                return;
              }
              const pendingDir = path.join(
                app.getPath("crashDumps"),
                "pending",
              );
              void shell.openPath(pendingDir).then((err) => {
                if (err) void shell.openPath(app.getPath("crashDumps"));
              });
            },
          },
          ...(isDevBuild()
            ? [
                {
                  label: "Test: terminate renderer (forced shutdown, no fault)",
                  click: () => {
                    const win = BrowserWindow.getFocusedWindow();
                    if (!win) return;
                    win.webContents.forcefullyCrashRenderer();
                  },
                },
                {
                  label: "Test: crash renderer (in-process, EXC_BAD_ACCESS)",
                  click: () => {
                    const win = BrowserWindow.getFocusedWindow();
                    if (!win) return;
                    void win.webContents.executeJavaScript(
                      "window.__posthogCodeTest.crash()",
                    );
                  },
                },
                {
                  label: "Test: abort renderer (in-process, SIGABRT)",
                  click: () => {
                    const win = BrowserWindow.getFocusedWindow();
                    if (!win) return;
                    void win.webContents.executeJavaScript(
                      "window.__posthogCodeTest.abort()",
                    );
                  },
                },
                {
                  label: "Test: crash main process (SIGABRT)",
                  click: () => {
                    process.crash();
                  },
                },
              ]
            : []),
          { type: "separator" },
          {
            label: "Invalidate OAuth token",
            click: () => {
              void container
                .get<UIService>(MAIN_TOKENS.UIService)
                .invalidateToken();
            },
          },
          {
            label: "Force refresh of OAuth token",
            click: () => {
              container
                .get<AuthService>(MAIN_TOKENS.AuthService)
                .refreshAccessToken()
                .then(() => {
                  dialog.showMessageBox({
                    type: "info",
                    title: "OAuth Token Refreshed",
                    message: "Access token refreshed successfully.",
                  });
                })
                .catch((err: Error) => {
                  dialog.showMessageBox({
                    type: "error",
                    title: "OAuth Token Refresh Failed",
                    message: err.message,
                  });
                });
            },
          },
          {
            label: "Refresh MCP Apps discovery",
            click: () => {
              container
                .get<McpAppsService>(MAIN_TOKENS.McpAppsService)
                .refreshDiscovery()
                .then(() => {
                  dialog.showMessageBox({
                    type: "info",
                    title: "MCP Apps Refreshed",
                    message:
                      "Cleared all cached resources and re-ran discovery.\nCheck logs for details.",
                  });
                })
                .catch((err: Error) => {
                  dialog.showMessageBox({
                    type: "error",
                    title: "MCP Apps Refresh Failed",
                    message: err.message,
                  });
                });
            },
          },
          { type: "separator" },
          {
            label: "Clear application storage",
            click: () => {
              container.get<UIService>(MAIN_TOKENS.UIService).clearStorage();
            },
          },
        ],
      },
    ],
  };
}

function buildEditMenu(): MenuItemConstructorOptions {
  return {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  };
}

function buildViewMenu(): MenuItemConstructorOptions {
  return {
    label: "View",
    submenu: [
      {
        label: "Reload",
        accelerator: "CmdOrCtrl+Shift+R",
        click: () => BrowserWindow.getFocusedWindow()?.webContents.reload(),
      },
      {
        label: "Force Reload",
        accelerator: "CmdOrCtrl+Shift+Alt+R",
        click: () =>
          BrowserWindow.getFocusedWindow()?.webContents.reloadIgnoringCache(),
      },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
      { type: "separator" },
      {
        label: "Reset layout",
        click: () => {
          container.get<UIService>(MAIN_TOKENS.UIService).resetLayout();
        },
      },
    ],
  };
}

function buildWindowMenu(): MenuItemConstructorOptions {
  return {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "front" },
    ],
  };
}
