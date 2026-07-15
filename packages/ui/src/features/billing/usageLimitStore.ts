import type { GatewayLimitCause } from "@posthog/shared";
import { create } from "zustand";

export type UsageLimitBucket = "burst" | "sustained";

export interface UsageLimitShowArgs {
  bucket?: UsageLimitBucket;
  resetAt?: string;
  isPro?: boolean;
  /**
   * Which gateway limit/gate tripped (usage-based billing). Drives the
   * cause-specific copy; legacy callers that only know the bucket omit it.
   */
  cause?: GatewayLimitCause;
  /** The model the free-tier gate blocked, when known (cause "model_gate"). */
  model?: string;
}

interface UsageLimitState {
  isOpen: boolean;
  bucket: UsageLimitBucket | null;
  resetAt: string | null;
  isPro: boolean | null;
  cause: GatewayLimitCause | null;
  model: string | null;
}

interface UsageLimitActions {
  show: (args?: UsageLimitShowArgs) => void;
  hide: () => void;
}

type UsageLimitStore = UsageLimitState & UsageLimitActions;

export const useUsageLimitStore = create<UsageLimitStore>()((set) => ({
  isOpen: false,
  bucket: null,
  resetAt: null,
  isPro: null,
  cause: null,
  model: null,

  show: (args) =>
    set({
      isOpen: true,
      bucket: args?.bucket ?? null,
      resetAt: args?.resetAt ?? null,
      isPro: args?.isPro ?? null,
      cause: args?.cause ?? null,
      model: args?.model ?? null,
    }),
  hide: () => set({ isOpen: false }),
}));
