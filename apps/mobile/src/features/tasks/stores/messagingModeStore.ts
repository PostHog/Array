import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type MessagingMode = "queue" | "steer";

interface MessagingModeState {
  /** Per-task overrides. Absent entries fall back to `defaultMode`. */
  modesByTaskId: Record<string, MessagingMode>;
  defaultMode: MessagingMode;
  setMode: (taskId: string, mode: MessagingMode) => void;
  setDefaultMode: (mode: MessagingMode) => void;
  getEffectiveMode: (taskId: string | undefined) => MessagingMode;
}

export const useMessagingModeStore = create<MessagingModeState>()(
  persist(
    (set, get) => ({
      modesByTaskId: {},
      defaultMode: "steer",
      setMode: (taskId, mode) =>
        set((state) => ({
          modesByTaskId: { ...state.modesByTaskId, [taskId]: mode },
        })),
      setDefaultMode: (defaultMode) => set({ defaultMode }),
      getEffectiveMode: (taskId) => {
        const state = get();
        return (
          (taskId ? state.modesByTaskId[taskId] : undefined) ??
          state.defaultMode
        );
      },
    }),
    {
      name: "messaging-mode-storage",
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      // Pre-v1 installs persisted the old "queue" default, so flip them to the
      // new "steer" default once. Per-task overrides are left untouched.
      migrate: (persisted, version) => {
        const state = persisted as Pick<
          MessagingModeState,
          "modesByTaskId" | "defaultMode"
        >;
        if (version < 1 && state.defaultMode === "queue") {
          return { ...state, defaultMode: "steer" };
        }
        return state;
      },
      partialize: (state) => ({
        modesByTaskId: state.modesByTaskId,
        defaultMode: state.defaultMode,
      }),
    },
  ),
);
