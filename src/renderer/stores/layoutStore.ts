import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LayoutStore {
  cliPanelWidth: number;
  setCliPanelWidth: (width: number) => void;
}

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      cliPanelWidth: 30,
      setCliPanelWidth: (width) => set({ cliPanelWidth: width }),
    }),
    {
      name: "layout-storage",
    },
  ),
);
