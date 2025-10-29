import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DefaultRunMode = "local" | "cloud" | "last_used";

interface SettingsStore {
  autoRunTasks: boolean;
  defaultRunMode: DefaultRunMode;
  lastUsedRunMode: "local" | "cloud";

  setAutoRunTasks: (autoRun: boolean) => void;
  setDefaultRunMode: (mode: DefaultRunMode) => void;
  setLastUsedRunMode: (mode: "local" | "cloud") => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      autoRunTasks: true,
      defaultRunMode: "last_used",
      lastUsedRunMode: "local",

      setAutoRunTasks: (autoRun) => set({ autoRunTasks: autoRun }),
      setDefaultRunMode: (mode) => set({ defaultRunMode: mode }),
      setLastUsedRunMode: (mode) => set({ lastUsedRunMode: mode }),
    }),
    {
      name: "settings-storage",
    },
  ),
);
