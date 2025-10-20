import dns from "node:dns";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  shell,
} from "electron";
import { registerAgentIpc, type TaskController } from "./services/agent.js";
import { registerFsIpc } from "./services/fs.js";
import { registerOsIpc } from "./services/os.js";
import { registerPosthogIpc } from "./services/posthog.js";
import { registerRecordingIpc } from "./services/recording-notranscribe.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
const taskControllers = new Map<string, TaskController>();

// Force IPv4 resolution when "localhost" is used so the agent hits 127.0.0.1
// instead of ::1. This matches how the renderer already reaches the PostHog API.
dns.setDefaultResultOrder("ipv4first");

function ensureClaudeConfigDir(): void {
  const existing = process.env.CLAUDE_CONFIG_DIR;
  if (existing) return;

  const userDataDir = app.getPath("userData");
  const claudeDir = path.join(userDataDir, "claude");

  mkdirSync(claudeDir, { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
}

function setupExternalLinkHandlers(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const appUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL || "file://";
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    titleBarStyle: "hiddenInset",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      enableBlinkFeatures: "GetDisplayMedia",
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });

  setupExternalLinkHandlers(mainWindow);

  // Enable screen/audio capture for recordings
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if (permission === "media" || permission === "mediaKeySystem") {
        callback(true);
      } else {
        callback(false);
      }
    },
  );

  // Handle display media requests (screen/window sharing)
  mainWindow.webContents.session.setPermissionCheckHandler(
    (_webContents, permission) => {
      if (permission === "media") {
        return true;
      }
      return false;
    },
  );

  // Set up menu for keyboard shortcuts
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Array",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            mainWindow?.webContents.send("open-settings");
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
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
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);
app.whenReady().then(ensureClaudeConfigDir);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Register IPC handlers via services
registerPosthogIpc();
registerOsIpc(() => mainWindow);
registerAgentIpc(taskControllers, () => mainWindow);
registerFsIpc();
registerRecordingIpc();
