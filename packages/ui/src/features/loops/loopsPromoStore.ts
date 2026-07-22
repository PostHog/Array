import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LoopsPromoState {
  dismissed: boolean;
  // Hydration is async (Electron storage over IPC); the card must not flash
  // for users whose persisted dismissal hasn't been read back yet.
  _hasHydrated: boolean;
  dismiss: () => void;
  reset: () => void;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useLoopsPromoStore = create<LoopsPromoState>()(
  persist(
    (set) => ({
      dismissed: false,
      _hasHydrated: false,
      dismiss: () => set({ dismissed: true }),
      reset: () => set({ dismissed: false }),
      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),
    }),
    {
      name: "posthog-code-loops-promo-dismissed",
      storage: electronStorage,
      partialize: (state) => ({ dismissed: state.dismissed }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHasHydrated(true);
          return;
        }
        useLoopsPromoStore.setState({ _hasHydrated: true });
      },
    },
  ),
);
