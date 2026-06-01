import type { ConfigurableShortcutId } from "@renderer/constants/keyboard-shortcuts";
import { resolveKey, useKeybindingsStore } from "@stores/keybindingsStore";

export function useShortcut(id: ConfigurableShortcutId): string {
  return useKeybindingsStore((s) => resolveKey(s.customKeybindings, id));
}
