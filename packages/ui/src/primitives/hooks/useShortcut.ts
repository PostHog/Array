import type { ConfigurableShortcutId } from "../../features/command/keyboard-shortcuts";
import { resolveKey, useKeybindingsStore } from "../../shell/keybindingsStore";

export function useShortcut(id: ConfigurableShortcutId): string {
  return useKeybindingsStore((s) => resolveKey(s.customKeybindings, id));
}
