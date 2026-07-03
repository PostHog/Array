import { UPDATES_SERVICE } from "@posthog/core/updates/identifiers";
import type { UpdatesService } from "@posthog/core/updates/updates";
import {
  DEV_HOST_ACTIONS_SERVICE,
  type IDevHostActions,
} from "@posthog/platform/dev-host-actions";
import { TypedEventEmitter } from "@posthog/shared";
import { inject, injectable } from "inversify";
import { DEV_NETWORK_SERVICE } from "../../di/tokens";
import { getUserDataDir } from "../../utils/env";
import { getLogFilePath, logger } from "../../utils/logger";
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
    @inject(DEV_HOST_ACTIONS_SERVICE)
    private readonly host: IDevHostActions,
    @inject(UPDATES_SERVICE)
    private readonly updates: UpdatesService,
  ) {
    super();
  }

  async openUserDataDir(): Promise<void> {
    await this.host.openPath(getUserDataDir());
  }

  async openLogFile(): Promise<void> {
    await this.host.openPath(getLogFilePath());
  }

  reloadRenderer(): void {
    this.host.reloadAllWindows();
  }

  restartMain(): void {
    log.warn("Restarting main process from dev toolbar");
    this.host.relaunch();
  }

  /**
   * Surfaces the real update banner in the sidebar without a packaged build or
   * a downloaded artifact. Clicking Restart runs the normal install path,
   * so the update-restart behaviour can be exercised in local dev.
   */
  simulateUpdate(): void {
    log.warn("Simulating an available update from dev toolbar");
    this.updates.simulateUpdateReady();
  }

  crashMain(): void {
    log.warn("Crashing main process from dev toolbar");
    this.host.crash();
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
