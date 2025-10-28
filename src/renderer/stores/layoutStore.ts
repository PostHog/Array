import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LayoutStore {
  cliPanelWidth: number;
  setCliPanelWidth: (width: number) => void;
  taskDetailSplitWidth: number;
  setTaskDetailSplitWidth: (width: number) => void;
  cliMode: "task" | "shell";
  setCliMode: (
    mode: "task" | "shell" | ((current: "task" | "shell") => "task" | "shell"),
  ) => void;
}

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set, get) => ({
      cliPanelWidth: 30,
      setCliPanelWidth: (width) => set({ cliPanelWidth: width }),
      taskDetailSplitWidth: 50,
      setTaskDetailSplitWidth: (width) => set({ taskDetailSplitWidth: width }),
      cliMode: "task",
      setCliMode: (mode) => {
        const newMode = typeof mode === "function" ? mode(get().cliMode) : mode;
        set({ cliMode: newMode });
      },
    }),
    {
      name: "layout-storage",
    },
  ),
);
