import {
  CONFIGURABLE_SHORTCUT_IDS,
  type ConfigurableShortcutId,
  DEFAULT_KEYBINDINGS,
  KEYBOARD_SHORTCUTS,
} from "@renderer/constants/keyboard-shortcuts";
import { electronStorage } from "@utils/electronStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const MAX_CUSTOM_BINDINGS = 2;

interface KeybindingsState {
  customKeybindings: Partial<Record<ConfigurableShortcutId, string[]>>;
  getKey: (id: ConfigurableShortcutId) => string;
  addKeybinding: (id: ConfigurableShortcutId, key: string) => void;
  updateKeybinding: (
    id: ConfigurableShortcutId,
    oldKey: string,
    newKey: string,
  ) => void;
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

/**
 * Split a keybinding string by comma, but preserve commas that are part of a
 * key combo (e.g. "mod+," must not be split at the trailing comma).
 * A valid separator comma is one NOT immediately preceded by "+".
 */
export function splitBindings(keyStr: string): string[] {
  return keyStr
    .split(/(?<!\+),/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export interface ConflictResult {
  id: ConfigurableShortcutId | null;
  description: string | null;
  /** true when the conflicting shortcut is not user-configurable */
  isFixed: boolean;
}

export function findConflict(
  newKey: string,
  excludeId: ConfigurableShortcutId,
): ConflictResult {
  const state = useKeybindingsStore.getState();

  for (const id of CONFIGURABLE_SHORTCUT_IDS) {
    if (id === excludeId) continue;
    const keyStr = state.getKey(id);
    const parts = splitBindings(keyStr);
    if (parts.includes(newKey)) {
      const entry = KEYBOARD_SHORTCUTS.find((s) => s.id === id);
      return { id, description: entry?.description ?? id, isFixed: false };
    }
  }

  for (const shortcut of KEYBOARD_SHORTCUTS) {
    if (
      CONFIGURABLE_SHORTCUT_IDS.includes(shortcut.id as ConfigurableShortcutId)
    )
      continue;
    const parts = splitBindings(shortcut.keys);
    if (shortcut.alternateKeys) {
      parts.push(...splitBindings(shortcut.alternateKeys));
    }
    if (parts.includes(newKey)) {
      return { id: null, description: shortcut.description, isFixed: true };
    }
  }

  return { id: null, description: null, isFixed: false };
}

export const useKeybindingsStore = create<KeybindingsState>()(
  persist(
    (set, get) => ({
      customKeybindings: {},

      getKey: (id) => resolveKey(get().customKeybindings, id),

      addKeybinding: (id, key) => {
        const existing = get().customKeybindings[id] ?? [];
        if (existing.includes(key)) return;
        if (existing.length >= MAX_CUSTOM_BINDINGS) return;
        set({
          customKeybindings: {
            ...get().customKeybindings,
            [id]: [...existing, key],
          },
        });
      },

      updateKeybinding: (id, oldKey, newKey) => {
        const existing = get().customKeybindings[id] ?? [];
        // When editing a default binding, copy all defaults first so the other
        // defaults are preserved — only the edited key gets replaced.
        const base =
          existing.length > 0
            ? existing
            : splitBindings(DEFAULT_KEYBINDINGS[id]);
        const updated = base.map((k) => (k === oldKey ? newKey : k));
        // Deduplicate — conflict detection excludes the edited shortcut's own bindings,
        // so editing one binding to match another on the same shortcut can slip through.
        const deduped = [...new Set(updated)];
        set({
          customKeybindings: { ...get().customKeybindings, [id]: deduped },
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
