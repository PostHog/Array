import { connectivityStore } from "@posthog/core/connectivity/connectivityStore";
import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import type { Contribution } from "@posthog/di/contribution";
import { inject, injectable } from "inversify";

/**
 * Drives session recovery off the network-reconnect event. Subscribes to the
 * connectivity store and, on an offline→online transition, asks the session
 * service to retry errored cloud streams and flush cloud message queues that
 * stranded while offline.
 *
 * This closes the one recovery gap the existing triggers left open: window
 * focus (`GlobalEventHandlers`) and auth-restored (`AuthContribution`) already
 * call into the same recovery, but a network blip that resolves while the app
 * stays focused and authenticated fired neither. Local sessions are unaffected
 * — they reconnect on their own once `reconcileLocalConnection` re-runs as
 * `isOnline` flips back.
 */
@injectable()
export class NetworkReconnectContribution implements Contribution {
  constructor(
    @inject(SESSION_SERVICE)
    private readonly sessionService: SessionService,
  ) {}

  start(): void {
    let wasOnline = connectivityStore.getState().isOnline;
    connectivityStore.subscribe((state) => {
      const justCameOnline = !wasOnline && state.isOnline;
      wasOnline = state.isOnline;
      if (justCameOnline) {
        this.sessionService.recoverAfterReconnect();
      }
    });
  }
}
