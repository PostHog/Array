import { create } from "zustand";

interface UpdateBannerStore {
  dismissedVersion: string | null;
  dismiss: (version: string) => void;
  reset: () => void;
}

export const useUpdateBannerStore = create<UpdateBannerStore>((set) => ({
  dismissedVersion: null,
  dismiss: (version) => set({ dismissedVersion: version }),
  reset: () => set({ dismissedVersion: null }),
}));
