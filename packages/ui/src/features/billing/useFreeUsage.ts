import { isCodeUsageUnbilled } from "@posthog/core/billing/usageDisplay";
import type { UsageOutput } from "@posthog/core/usage/schemas";
import { USAGE_BILLING_FLAG } from "@posthog/shared";
import { useFeatureFlag } from "../feature-flags/useFeatureFlag";
import { useSeat } from "./useSeat";
import { useUsage } from "./useUsage";

export interface FreeUsageResult {
  usage: UsageOutput | null;
  // True when the user is eligible to see the Free sidebar bar but data
  // hasn't arrived yet. Distinguishes "show skeleton" from "render nothing".
  isLoading: boolean;
}

export function useFreeUsage(billingEnabled: boolean): FreeUsageResult {
  const usageBillingEnabled = useFeatureFlag(USAGE_BILLING_FLAG);
  const { seat, isPro } = useSeat();
  const seatLoaded = seat !== null;
  // Seat era: free-seat holders only. Usage era: seats are gone — fetch for
  // everyone, then show only orgs the gateway confirms as unbilled (the free
  // tier's per-user allowance is the meaningful meter).
  const eligible = usageBillingEnabled
    ? billingEnabled
    : billingEnabled && seatLoaded && !isPro;
  const { usage, isLoading } = useUsage({ enabled: eligible });

  if (!eligible) return { usage: null, isLoading: false };
  if (usageBillingEnabled && !isCodeUsageUnbilled(usage)) {
    // Billed org (no per-user caps to meter) or billed state unknown: the
    // free-tier bar would be noise or wrong — render nothing.
    return { usage: null, isLoading: usage ? false : isLoading };
  }
  return { usage: usage ?? null, isLoading };
}
