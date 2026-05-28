import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ThemePreference = "light" | "dark" | "system";

export type CompletionSound =
  | "meep"
  | "meep-smol"
  | "knock"
  | "ring"
  | "shoot"
  | "slide"
  | "drop";

export type InitialTaskMode = "plan" | "last_used";

interface PreferencesState {
  pingsEnabled: boolean;
  setPingsEnabled: (enabled: boolean) => void;
  pushNotificationsEnabled: boolean;
  setPushNotificationsEnabled: (enabled: boolean) => void;

  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;

  completionSound: CompletionSound;
  setCompletionSound: (sound: CompletionSound) => void;
  completionVolume: number;
  setCompletionVolume: (volume: number) => void;

  defaultInitialTaskMode: InitialTaskMode;
  setDefaultInitialTaskMode: (mode: InitialTaskMode) => void;
  /** Most recent mode the user picked in the new-task composer. Persisted so
   *  `defaultInitialTaskMode === "last_used"` can pre-fill it next time. */
  lastNewTaskMode: string;
  setLastNewTaskMode: (mode: string) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      pingsEnabled: true,
      setPingsEnabled: (enabled) => set({ pingsEnabled: enabled }),
      pushNotificationsEnabled: true,
      setPushNotificationsEnabled: (enabled) =>
        set({ pushNotificationsEnabled: enabled }),

      theme: "system",
      setTheme: (theme) => set({ theme }),

      completionSound: "meep",
      setCompletionSound: (sound) => set({ completionSound: sound }),
      completionVolume: 70,
      setCompletionVolume: (volume) =>
        set({
          completionVolume: Math.max(0, Math.min(100, Math.round(volume))),
        }),

      defaultInitialTaskMode: "plan",
      setDefaultInitialTaskMode: (mode) =>
        set({ defaultInitialTaskMode: mode }),
      lastNewTaskMode: "plan",
      setLastNewTaskMode: (mode) => set({ lastNewTaskMode: mode }),
    }),
    {
      name: "posthog-preferences",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        pingsEnabled: state.pingsEnabled,
        pushNotificationsEnabled: state.pushNotificationsEnabled,
        theme: state.theme,
        completionSound: state.completionSound,
        completionVolume: state.completionVolume,
        defaultInitialTaskMode: state.defaultInitialTaskMode,
        lastNewTaskMode: state.lastNewTaskMode,
      }),
    },
  ),
);
