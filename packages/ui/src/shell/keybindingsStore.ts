import {
  CONFIGURABLE_SHORTCUT_IDS,
  type ConfigurableShortcutId,
  DEFAULT_KEYBINDINGS,
} from "../features/command/keyboard-shortcuts";
import { electronStorage } from "./rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface KeybindingsState {
  customKeybindings: Partial<Record<ConfigurableShortcutId, string[]>>;
  getKey: (id: ConfigurableShortcutId) => string;
  addKeybinding: (id: ConfigurableShortcutId, key: string) => void;
  removeKeybinding: (id: ConfigurableShortcutId, key: string) => void;
  resetShortcut: (id: ConfigurableShortcutId) => void;
  resetAll: () => void;
}

export function resolveKey(
  customKeybindings: Partial<Record<ConfigurableShortcutId, string[]>>,
  id: ConfigurableShortcutId,
): string {
  const customs = customKeybindings[id];
  if (customs && customs.length > 0) return customs.join(",");
  return DEFAULT_KEYBINDINGS[id];
}

export function findConflict(
  newKey: string,
  excludeId: ConfigurableShortcutId,
): ConfigurableShortcutId | null {
  const state = useKeybindingsStore.getState();
  for (const id of CONFIGURABLE_SHORTCUT_IDS) {
    if (id === excludeId) continue;
    const keyStr = state.getKey(id);
    const parts = keyStr.split(",").map((k) => k.trim());
    if (parts.includes(newKey)) return id;
  }
  return null;
}

export const useKeybindingsStore = create<KeybindingsState>()(
  persist(
    (set, get) => ({
      customKeybindings: {},

      getKey: (id) => resolveKey(get().customKeybindings, id),

      addKeybinding: (id, key) => {
        const existing = get().customKeybindings[id] ?? [];
        if (existing.includes(key)) return;
        set({
          customKeybindings: {
            ...get().customKeybindings,
            [id]: [...existing, key],
          },
        });
      },

      removeKeybinding: (id, key) => {
        const existing = get().customKeybindings[id] ?? [];
        const updated = existing.filter((k) => k !== key);
        set({
          customKeybindings: {
            ...get().customKeybindings,
            [id]: updated,
          },
        });
      },

      resetShortcut: (id) => {
        const { [id]: _removed, ...rest } = get().customKeybindings;
        set({
          customKeybindings: rest as Partial<
            Record<ConfigurableShortcutId, string[]>
          >,
        });
      },

      resetAll: () => set({ customKeybindings: {} }),
    }),
    {
      name: "keybindings-storage",
      storage: electronStorage,
      partialize: (state) => ({ customKeybindings: state.customKeybindings }),
    },
  ),
);
