import type {
  SeatClient,
  SubscriptionEventProps,
} from "@posthog/core/billing/identifiers";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import type { SeatData } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { inject, injectable } from "inversify";
import { track } from "../../shell/analytics";
import {
  IMPERATIVE_QUERY_CLIENT,
  type ImperativeQueryClient,
} from "../../shell/queryClient";
import { getAuthenticatedClient } from "../auth/authClientImperative";

async function authedClient() {
  const client = await getAuthenticatedClient();
  if (!client) {
    throw new Error("Not authenticated");
  }
  return client;
}

@injectable()
export class UiSeatClient implements SeatClient {
  constructor(
    @inject(HOST_TRPC_CLIENT)
    private readonly hostClient: HostTrpcClient,
    @inject(IMPERATIVE_QUERY_CLIENT)
    private readonly queryClient: ImperativeQueryClient,
  ) {}

  async getMySeat(options?: { best?: boolean }): Promise<SeatData | null> {
    return (await authedClient()).getMySeat(options);
  }

  async createSeat(planKey: string): Promise<SeatData> {
    return (await authedClient()).createSeat(planKey);
  }

  async upgradeSeat(planKey: string): Promise<SeatData> {
    return (await authedClient()).upgradeSeat(planKey);
  }

  async cancelSeat(): Promise<void> {
    await (await authedClient()).cancelSeat();
  }

  async reactivateSeat(): Promise<SeatData> {
    return (await authedClient()).reactivateSeat();
  }

  invalidatePlanCache(): void {
    this.hostClient.llmGateway.invalidatePlanCache.mutate().catch(() => {});
    void this.queryClient.invalidateQueries({ queryKey: [["llmGateway"]] });
  }

  trackSubscriptionStarted(props: SubscriptionEventProps): void {
    track(ANALYTICS_EVENTS.SUBSCRIPTION_STARTED, props);
  }

  trackSubscriptionCancelled(props: SubscriptionEventProps): void {
    track(ANALYTICS_EVENTS.SUBSCRIPTION_CANCELLED, props);
  }
}
