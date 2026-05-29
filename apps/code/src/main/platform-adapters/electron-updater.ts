import type { IUpdater } from "@posthog/platform/updater";
import { app, autoUpdater } from "electron";
import { injectable } from "inversify";

@injectable()
export class ElectronUpdater implements IUpdater {
  public isSupported(): boolean {
    return (
      app.isPackaged &&
      !process.env.ELECTRON_DISABLE_AUTO_UPDATE &&
      (process.platform === "darwin" || process.platform === "win32")
    );
  }

  public setFeedUrl(url: string): void {
    autoUpdater.setFeedURL({ url });
  }

  public check(): void {
    autoUpdater.checkForUpdates();
  }

  public quitAndInstall(): void {
    autoUpdater.quitAndInstall();
  }

  public onCheckStart(handler: () => void): () => void {
    const l = () => handler();
    autoUpdater.on("checking-for-update", l);
    return () => autoUpdater.off("checking-for-update", l);
  }

  public onUpdateAvailable(handler: () => void): () => void {
    const l = () => handler();
    autoUpdater.on("update-available", l);
    return () => autoUpdater.off("update-available", l);
  }

  public onUpdateDownloaded(handler: (version: string) => void): () => void {
    const l = (_event: unknown, _releaseNotes: string, releaseName: string) =>
      handler(releaseName);
    autoUpdater.on("update-downloaded", l);
    return () => autoUpdater.off("update-downloaded", l);
  }

  public onNoUpdate(handler: () => void): () => void {
    const l = () => handler();
    autoUpdater.on("update-not-available", l);
    return () => autoUpdater.off("update-not-available", l);
  }

  public onError(handler: (error: Error) => void): () => void {
    const l = (error: Error) => handler(error);
    autoUpdater.on("error", l);
    return () => autoUpdater.off("error", l);
  }
}
