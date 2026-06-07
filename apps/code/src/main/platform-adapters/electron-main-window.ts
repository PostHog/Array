import type { IMainWindow } from "@posthog/platform/main-window";
import { app, type BrowserWindow } from "electron";
import { injectable } from "inversify";

@injectable()
export class ElectronMainWindow implements IMainWindow {
  private mainWindowGetter: (() => BrowserWindow | null) | null = null;

  public setMainWindowGetter(getter: () => BrowserWindow | null): void {
    this.mainWindowGetter = getter;
  }

  public getBrowserWindow(): BrowserWindow | null {
    return this.mainWindowGetter?.() ?? null;
  }

  public focus(): void {
    this.getBrowserWindow()?.focus();
  }

  public isFocused(): boolean {
    return this.getBrowserWindow()?.isFocused() ?? false;
  }

  public isMinimized(): boolean {
    return this.getBrowserWindow()?.isMinimized() ?? false;
  }

  public restore(): void {
    this.getBrowserWindow()?.restore();
  }

  public onFocus(handler: () => void): () => void {
    const listener = () => handler();
    app.on("browser-window-focus", listener);
    return () => app.off("browser-window-focus", listener);
  }

  public getZoomLevel(): number {
    return this.getBrowserWindow()?.webContents.getZoomLevel() ?? 0;
  }

  public setZoomLevel(level: number): void {
    const webContents = this.getBrowserWindow()?.webContents;
    if (webContents) {
      webContents.setZoomLevel(level);
    }
  }
}
