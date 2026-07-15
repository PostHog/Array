import type { GatewayLimitCause } from "@posthog/shared";
import { create } from "zustand";

export type UsageLimitBucket = "burst" | "sustained";

export interface UsageLimitShowArgs {
  bucket?: UsageLimitBucket;
  resetAt?: string;
  isPro?: boolean;
  /** Which gateway denial tripped (drives the usage-based copy). */
  cause?: GatewayLimitCause;
  /** The model the gate blocked, when known. */
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
