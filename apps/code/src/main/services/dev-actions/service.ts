import { app, BrowserWindow, shell } from "electron";
import { inject, injectable } from "inversify";
import { DEV_NETWORK_SERVICE } from "../../di/tokens";
import { getUserDataDir } from "../../utils/env";
import { getLogFilePath, logger } from "../../utils/logger";
import { TypedEventEmitter } from "@posthog/shared";
import type { DevNetworkService } from "../dev-network/service";
import {
  DevActionsEvent,
  type DevActionsEvents,
  type DevToast,
} from "./schemas";

const log = logger.scope("dev-actions");

@injectable()
export class DevActionsService extends TypedEventEmitter<DevActionsEvents> {
  private nextToastId = 1;

  constructor(
    @inject(DEV_NETWORK_SERVICE)
    private readonly network: DevNetworkService,
  ) {
    super();
  }

  async openUserDataDir(): Promise<void> {
    await shell.openPath(getUserDataDir());
  }

  async openLogFile(): Promise<void> {
    await shell.openPath(getLogFilePath());
  }

  reloadRenderer(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.reload();
    }
  }

  restartMain(): void {
    log.warn("Restarting main process from dev toolbar");
    app.relaunch();
    app.exit(0);
  }

  crashMain(): void {
    log.warn("Crashing main process from dev toolbar");
    process.crash();
  }

  triggerToast(variant: "info" | "error", message: string): DevToast {
    const toast: DevToast = {
      id: this.nextToastId++,
      variant,
      message,
    };
    this.emit(DevActionsEvent.Toast, toast);
    return toast;
  }

  setOffline(offline: boolean): void {
    this.network.setSim({ offline });
  }

  setSlowDelay(slowDelayMs: number): void {
    this.network.setSim({ slowDelayMs });
  }
}
