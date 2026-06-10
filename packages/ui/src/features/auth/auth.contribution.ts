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
  ) {}

  async start(): Promise<void> {
    this.hostClient.auth.onStateChanged.subscribe(undefined, {
      onData: (state) => useAuthStore.getState().setAuthState(state),
    });

    const outcome = await withTimeout(
      this.hostClient.auth.getState.query(),
      INITIAL_STATE_TIMEOUT_MS,
    );
    if (outcome.result === "success") {
      useAuthStore.getState().setAuthState(outcome.value);
    } else {
      log.warn(
        "Initial auth state query timed out; relying on state subscription",
      );
    }
  }
}
