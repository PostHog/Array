import { useSeat } from "@hooks/useSeat";
import type { UsageOutput } from "@main/services/llm-gateway/schemas";
import { useUsage } from "./useUsage";

export interface FreeUsageResult {
  usage: UsageOutput | null;
  // True when the user is eligible to see the Free sidebar bar but data
  // hasn't arrived yet. Distinguishes "show skeleton" from "render nothing".
  isLoading: boolean;
}

export function useFreeUsage(billingEnabled: boolean): FreeUsageResult {
  const { seat, isPro } = useSeat();
  const seatLoaded = seat !== null;
  const eligible = billingEnabled && seatLoaded && !isPro;
  const { usage, isLoading } = useUsage({ enabled: eligible });

  if (!eligible) return { usage: null, isLoading: false };
  return { usage: usage ?? null, isLoading };
}
