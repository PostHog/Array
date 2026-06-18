import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type HomeViewMode = "list" | "board" | "config";

interface HomeUiStore {
  viewMode: HomeViewMode;
  setViewMode: (mode: HomeViewMode) => void;
  selectedWorkstreamId: string | null;
  setSelectedWorkstreamId: (id: string | null) => void;
}

export const useHomeUiStore = create<HomeUiStore>()(
  persist(
    (set) => ({
      viewMode: "list",
      setViewMode: (mode) => set({ viewMode: mode }),
      selectedWorkstreamId: null,
      setSelectedWorkstreamId: (id) => set({ selectedWorkstreamId: id }),
    }),
    {
      name: "home-ui-store",
      storage: electronStorage,
      partialize: (state) => ({ viewMode: state.viewMode }),
    },
  ),
);
