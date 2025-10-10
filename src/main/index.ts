import dns from "node:dns";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";
import { registerAgentIpc, type TaskController } from "./services/agent.js";
import { registerOsIpc } from "./services/os.js";
import { registerPosthogIpc } from "./services/posthog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev =
  process.env.NODE_ENV === "development" || process.argv.includes("--dev");

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
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });

  // Set up menu for keyboard shortcuts
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Array",
      submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
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

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
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
