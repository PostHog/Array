import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import type { Contribution } from "@posthog/di/contribution";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import { withTimeout } from "@posthog/shared";
import { logger } from "@posthog/ui/shell/logger";
import { inject, injectable } from "inversify";
import { useAuthStore } from "./store";

const log = logger.scope("auth-contribution");
// boot() starts contributions serially, so a stuck host query must not wedge it.
const INITIAL_STATE_TIMEOUT_MS = 10_000;

@injectable()
export class AuthContribution implements Contribution {
  constructor(
    @inject(HOST_TRPC_CLIENT)
    private readonly hostClient: HostTrpcClient,
    @inject(SESSION_SERVICE)
    private readonly sessionService: SessionService,
  ) {}

  async start(): Promise<void> {
    this.hostClient.auth.onStateChanged.subscribe(undefined, {
      onData: (state) => {
        useAuthStore.getState().setAuthState(state);
        if (state.status === "authenticated") {
          this.sessionService.flushQueuedCloudMessagesAfterAuthRestored();
        }
      },
    });

    const outcome = await withTimeout(
      this.hostClient.auth.getState.query(),
      INITIAL_STATE_TIMEOUT_MS,
    );
    if (outcome.result === "success") {
      useAuthStore.getState().setAuthState(outcome.value);
      if (outcome.value.status === "authenticated") {
        this.sessionService.flushQueuedCloudMessagesAfterAuthRestored();
      }
    } else {
      log.warn(
        "Initial auth state query timed out; relying on state subscription",
      );
    }
  }
}
