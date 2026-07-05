import { isUsageExceeded } from "@posthog/core/billing/usageDisplay";
import type { UsageOutput } from "@posthog/core/usage/schemas";
import { resolveService } from "@posthog/di/container";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { track } from "@posthog/ui/shell/analytics";
import { logger } from "@posthog/ui/shell/logger";
import { type UsageLimitBucket, useUsageLimitStore } from "./usageLimitStore";

const log = logger.scope("preflight-cloud-usage");

function usageLimitArgs(usage: UsageOutput): {
  bucket: UsageLimitBucket;
  resetAt: string;
  isPro: boolean;
} {
  // Prefer the bucket that's actually exceeded (burst/daily takes priority); if neither
  // is flagged (is_rate_limited via a server-side valve), fall back to the monthly bucket
  // so the modal still shows a title and reset time rather than a bare prompt.
  const bucket: UsageLimitBucket = usage.burst.exceeded ? "burst" : "sustained";
  return { bucket, resetAt: usage[bucket].reset_at, isPro: usage.is_pro };
}

async function fetchUsageSnapshot(): Promise<UsageOutput | null> {
  const client = resolveService<HostTrpcClient>(HOST_TRPC_CLIENT);
  const fresh = await client.usageMonitor.refresh.mutate().catch((error) => {
    log.warn("Usage refresh failed; falling back to latest snapshot", {
      error,
    });
    return null;
  });
  if (fresh) return fresh;

  return client.usageMonitor.getLatest.query().catch((error) => {
    log.warn("Usage lookup failed; allowing cloud creation", { error });
    return null;
  });
}

/**
 * Pre-flight gate for cloud task creation. Returns false (and shows the upgrade
 * modal) when the team is over its usage limit, so no cloud task/run is created.
 *
 * Best-effort: if usage can't be fetched, returns true (fail open) — a usage
 * service hiccup must never block task creation.
 */
export async function assertCloudUsageAvailable(): Promise<boolean> {
  const usage = await fetchUsageSnapshot();
  if (usage && isUsageExceeded(usage)) {
    const args = usageLimitArgs(usage);
    track(ANALYTICS_EVENTS.CLOUD_TASK_USAGE_BLOCKED, {
      bucket: args.bucket,
      is_pro: usage.is_pro,
    });
    useUsageLimitStore.getState().show(args);
    return false;
  }
  return true;
}
