import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LayoutStore {
  cliPanelWidth: number;
  setCliPanelWidth: (width: number) => void;
  cliMode: "task" | "shell";
  setCliMode: (mode: "task" | "shell") => void;
}

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      cliPanelWidth: 30,
      setCliPanelWidth: (width) => set({ cliPanelWidth: width }),
      cliMode: "task",
      setCliMode: (mode) => set({ cliMode: mode }),
    }),
    {
      name: "layout-storage",
    },
  ),
);
