import { create } from "zustand";

export type UsageLimitBucket = "burst" | "sustained";

interface UsageLimitState {
  isOpen: boolean;
  bucket: UsageLimitBucket | null;
  resetAt: string | null;
  isPro: boolean | null;
}

interface UsageLimitActions {
  show: (args?: {
    bucket: UsageLimitBucket;
    resetAt: string;
    isPro?: boolean;
  }) => void;
  hide: () => void;
}

type UsageLimitStore = UsageLimitState & UsageLimitActions;

export const useUsageLimitStore = create<UsageLimitStore>()((set) => ({
  isOpen: false,
  bucket: null,
  resetAt: null,
  isPro: null,

  show: (args) =>
    set({
      isOpen: true,
      bucket: args?.bucket ?? null,
      resetAt: args?.resetAt ?? null,
      isPro: args?.isPro ?? null,
    }),
  hide: () => set({ isOpen: false }),
}));
