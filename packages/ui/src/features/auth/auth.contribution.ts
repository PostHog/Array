import type { Contribution } from "@posthog/di/contribution";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import { inject, injectable } from "inversify";
import { useAuthStore } from "./store";

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

    const initial = await this.hostClient.auth.getState.query();
    useAuthStore.getState().setAuthState(initial);
  }
}
