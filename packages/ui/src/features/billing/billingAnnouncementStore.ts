import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface BillingAnnouncementState {
  acknowledged: boolean;
  // Hydration is async (Electron storage over IPC); the announcement must not
  // flash open before a persisted acknowledgment has been read back.
  _hasHydrated: boolean;
  acknowledge: () => void;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useBillingAnnouncementStore = create<BillingAnnouncementState>()(
  persist(
    (set) => ({
      acknowledged: false,
      _hasHydrated: false,
      acknowledge: () => set({ acknowledged: true }),
      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),
    }),
    {
      name: "posthog-code-usage-billing-acknowledged",
      storage: electronStorage,
      partialize: (state) => ({ acknowledged: state.acknowledged }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
