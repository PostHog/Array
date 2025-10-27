import { app, autoUpdater, type BrowserWindow, ipcMain } from "electron";

const UPDATE_SERVER_HOST = "https://update.electronjs.org";
const REPO_OWNER = "PostHog";
const REPO_NAME = "Array";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DISABLE_FLAG = "ELECTRON_DISABLE_AUTO_UPDATE";
const UPDATE_READY_CHANNEL = "updates:ready";
const INSTALL_UPDATE_CHANNEL = "updates:install";

let updateReady = false;
let pendingNotification = false;

function isAutoUpdateSupported(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

function buildFeedUrl(): string {
  return `${UPDATE_SERVER_HOST}/${REPO_OWNER}/${REPO_NAME}/${process.platform}-${process.arch}/${app.getVersion()}`;
}

function checkForUpdates(): void {
  try {
    const maybePromise = autoUpdater.checkForUpdates();
    if (
      typeof maybePromise === "object" &&
      maybePromise !== null &&
      "catch" in maybePromise &&
      typeof (maybePromise as Promise<unknown>).catch === "function"
    ) {
      const promise = maybePromise as Promise<unknown>;
      void promise.catch((error) => {
        console.error("[updates] Failed to check for updates", error);
      });
    }
  } catch (error) {
    console.error("[updates] Failed to initiate update check", error);
  }
}

export function registerAutoUpdater(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.removeHandler(INSTALL_UPDATE_CHANNEL);
  ipcMain.handle(INSTALL_UPDATE_CHANNEL, () => {
    if (!updateReady) {
      return { installed: false };
    }

    autoUpdater.quitAndInstall();
    return { installed: true };
  });

  if (process.env[DISABLE_FLAG]) {
    console.info("[updates] Auto updates disabled via environment flag");
    return;
  }

  if (!app.isPackaged) {
    return;
  }

  if (!isAutoUpdateSupported()) {
    console.info(
      "[updates] Auto updates are only enabled on macOS and Windows",
    );
    return;
  }

  const notifyRenderer = (): void => {
    const window = getWindow();
    if (window) {
      window.webContents.send(UPDATE_READY_CHANNEL);
      pendingNotification = false;
    } else {
      pendingNotification = true;
    }
  };

  app.on("browser-window-focus", () => {
    if (updateReady && pendingNotification) {
      notifyRenderer();
    }
  });

  app.whenReady().then(() => {
    const feedURL = buildFeedUrl();
    autoUpdater.setFeedURL({ url: feedURL });

    autoUpdater.on("error", (error) => {
      console.error("[updates] Auto update error", error);
    });

    autoUpdater.on("update-available", () => {
      console.info("[updates] Update available, downloading…");
    });

    autoUpdater.on("update-not-available", () => {
      console.info("[updates] No updates available");
    });

    autoUpdater.on("update-downloaded", () => {
      console.info("[updates] Update downloaded, awaiting user confirmation");
      updateReady = true;
      notifyRenderer();
    });

    checkForUpdates();
    setInterval(checkForUpdates, CHECK_INTERVAL_MS);
  });
}
