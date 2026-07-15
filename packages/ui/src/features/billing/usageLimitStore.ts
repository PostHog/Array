import type { GatewayLimitCause } from "@posthog/shared";
import { create } from "zustand";

export interface UsageLimitShowArgs {
  resetAt?: string;
  /** Which gateway denial tripped; unset renders the generic copy. */
  cause?: GatewayLimitCause;
  /** The model the gate blocked, when known. */
  model?: string;
}

interface UsageLimitState {
  isOpen: boolean;
  resetAt: string | null;
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
  resetAt: null,
  cause: null,
  model: null,

  show: (args) =>
    set({
      isOpen: true,
      resetAt: args?.resetAt ?? null,
      cause: args?.cause ?? null,
      model: args?.model ?? null,
    }),
  hide: () => set({ isOpen: false }),
}));
