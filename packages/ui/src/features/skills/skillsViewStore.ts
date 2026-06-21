import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SkillViewMode = "list" | "grid";

interface SkillsViewStore {
  viewMode: SkillViewMode;
  setViewMode: (mode: SkillViewMode) => void;
}

export const useSkillsViewStore = create<SkillsViewStore>()(
  persist(
    (set) => ({
      viewMode: "list",
      setViewMode: (viewMode) => set({ viewMode }),
    }),
    {
      name: "skills-view-mode",
      partialize: (s) => ({ viewMode: s.viewMode }),
    },
  ),
);
