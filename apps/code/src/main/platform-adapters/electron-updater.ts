import type { IUpdater } from "@posthog/platform/updater";
import { app } from "electron";
import log from "electron-log/main";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import { injectable } from "inversify";

@injectable()
export class ElectronUpdater implements IUpdater {
  constructor() {
    autoUpdater.logger = log;
    autoUpdater.disableDifferentialDownload = true;
  }

  public isSupported(): boolean {
    return (
      app.isPackaged &&
      !process.env.ELECTRON_DISABLE_AUTO_UPDATE &&
      (process.platform === "darwin" || process.platform === "win32")
    );
  }

  public check(): void {
    void autoUpdater.checkForUpdates();
  }

  public quitAndInstall(): void {
    autoUpdater.quitAndInstall(false, true);
  }

  public onCheckStart(handler: () => void): () => void {
    autoUpdater.on("checking-for-update", handler);
    return () => autoUpdater.off("checking-for-update", handler);
  }

  public onUpdateAvailable(handler: () => void): () => void {
    const l = (_info: UpdateInfo) => handler();
    autoUpdater.on("update-available", l);
    return () => autoUpdater.off("update-available", l);
  }

  public onUpdateDownloaded(handler: (version: string) => void): () => void {
    const l = (info: UpdateInfo) => handler(info.version);
    autoUpdater.on("update-downloaded", l);
    return () => autoUpdater.off("update-downloaded", l);
  }

  public onNoUpdate(handler: () => void): () => void {
    autoUpdater.on("update-not-available", handler);
    return () => autoUpdater.off("update-not-available", handler);
  }

  public onError(handler: (error: Error) => void): () => void {
    const l = (error: Error) => handler(error);
    autoUpdater.on("error", l);
    return () => autoUpdater.off("error", l);
  }
}
