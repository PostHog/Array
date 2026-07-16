import { isCodeUsageFreeTier } from "@posthog/core/billing/usageDisplay";
import type { UsageOutput } from "@posthog/core/usage/schemas";
import { useUsage } from "./useUsage";

export interface FreeUsageResult {
  usage: UsageOutput | null;
  // True when the user is eligible to see the free-tier meter but data
  // hasn't arrived yet. Distinguishes "show skeleton" from "render nothing".
  isLoading: boolean;
}

export function useFreeUsage(billingEnabled: boolean): FreeUsageResult {
  const { usage, isLoading } = useUsage({ enabled: billingEnabled });

  if (!billingEnabled) return { usage: null, isLoading: false };
  // Only confirmed free-tier orgs have a meaningful free-tier meter —
  // subscribed orgs have no per-user caps, and unknown must not render as free.
  if (!isCodeUsageFreeTier(usage)) {
    return { usage: null, isLoading: usage ? false : isLoading };
  }
  return { usage: usage ?? null, isLoading };
}
