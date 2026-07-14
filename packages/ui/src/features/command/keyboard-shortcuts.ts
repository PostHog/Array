import { isMac } from "@posthog/ui/utils/platform";

export const SHORTCUTS = {
  COMMAND_MENU: "mod+k",
  NEW_TASK: "mod+n",
  NEW_TAB: "mod+t",
  SETTINGS: "mod+,",
  SHORTCUTS_SHEET: "mod+/",
  GO_BACK: "mod+[",
  GO_FORWARD: "mod+]",
  // Arrow variants must stay outside form fields/editors, where mod+left/right
  // means jump to line start/end - bind them without enableOnFormTags.
  GO_BACK_ALT: "mod+left",
  GO_FORWARD_ALT: "mod+right",
  TOGGLE_LEFT_SIDEBAR: "mod+b",
  TOGGLE_REVIEW_PANEL: "mod+shift+b",
  PREV_TASK: "mod+shift+[,ctrl+shift+tab",
  NEXT_TASK: "mod+shift+],ctrl+tab",
  CLOSE_TAB: "mod+w",
  SWITCH_TAB: "ctrl+1,ctrl+2,ctrl+3,ctrl+4,ctrl+5,ctrl+6,ctrl+7,ctrl+8,ctrl+9",
  SWITCH_TASK: "mod+1,mod+2,mod+3,mod+4,mod+5,mod+6,mod+7,mod+8,mod+9",
  OPEN_IN_EDITOR: "mod+o",
  COPY_PATH: "mod+shift+c",
  TOGGLE_FOCUS: "mod+r",
  PASTE_AS_FILE: "mod+shift+v",
  INBOX: "mod+i",
  SPACE_UP: "mod+up",
  SPACE_DOWN: "mod+down",
  FIND_IN_CONVERSATION: "mod+f",
  FILE_PICKER: "mod+p",
  MESSAGE_PREV: "alt+up",
  MESSAGE_NEXT: "alt+down",
  MESSAGE_JUMP: "mod+j",
  BLUR: "escape",
  SUBMIT_BLUR: "mod+enter",
  SWITCH_MESSAGING_MODE: "mod+s",
  RELOAD_WINDOW: "mod+shift+r",
  ZOOM_IN: "mod+=",
  ZOOM_OUT: "mod+-",
  RESET_ZOOM: "mod+0",
} as const;

export type ShortcutCategory = "general" | "navigation" | "panels" | "editor";

export interface KeyboardShortcut {
  id: string;
  keys: string;
  description: string;
  category: ShortcutCategory;
  context?: string;
  alternateKeys?: string;
  configurable?: boolean;
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: "new-task",
    keys: "mod+n",
    description: "New task",
    category: "general",
    configurable: true,
  },
  {
    id: "new-tab",
    keys: SHORTCUTS.NEW_TAB,
    description: "New tab",
    category: "navigation",
    context: "Channels",
  },
  {
    id: "command-menu",
    keys: SHORTCUTS.COMMAND_MENU,
    description: "Open command menu",
    category: "general",
    configurable: true,
  },
  {
    id: "settings",
    keys: SHORTCUTS.SETTINGS,
    description: "Open settings",
    category: "general",
    configurable: true,
  },
  {
    id: "shortcuts",
    keys: SHORTCUTS.SHORTCUTS_SHEET,
    description: "Show keyboard shortcuts",
    category: "general",
    configurable: true,
  },
  {
    id: "zoom-in",
    keys: SHORTCUTS.ZOOM_IN,
    description: "Zoom in",
    category: "general",
  },
  {
    id: "zoom-out",
    keys: SHORTCUTS.ZOOM_OUT,
    description: "Zoom out",
    category: "general",
  },
  {
    id: "reset-zoom",
    keys: SHORTCUTS.RESET_ZOOM,
    description: "Reset zoom",
    category: "general",
  },
  {
    id: "switch-messaging-mode",
    keys: SHORTCUTS.SWITCH_MESSAGING_MODE,
    description: "Switch Steer / Queue mode",
    category: "editor",
    context: "Session composer",
  },
  {
    id: "inbox",
    keys: SHORTCUTS.INBOX,
    description: "Open inbox",
    category: "navigation",
    configurable: true,
  },
  {
    id: "switch-task",
    keys: "mod+1-9",
    description: "Switch to task 1-9",
    category: "navigation",
  },
  {
    id: "prev-task",
    keys: "mod+shift+[",
    description: "Previous task",
    category: "navigation",
    alternateKeys: "ctrl+shift+tab",
    configurable: true,
  },
  {
    id: "next-task",
    keys: "mod+shift+]",
    description: "Next task",
    category: "navigation",
    alternateKeys: "ctrl+tab",
    configurable: true,
  },
  {
    id: "space-up",
    keys: SHORTCUTS.SPACE_UP,
    description: "Previous space",
    category: "navigation",
    configurable: true,
  },
  {
    id: "space-down",
    keys: SHORTCUTS.SPACE_DOWN,
    description: "Next space",
    category: "navigation",
    configurable: true,
  },
  {
    id: "go-back",
    keys: SHORTCUTS.GO_BACK,
    description: "Go back",
    category: "navigation",
    configurable: true,
    alternateKeys: SHORTCUTS.GO_BACK_ALT,
  },
  {
    id: "go-forward",
    keys: SHORTCUTS.GO_FORWARD,
    description: "Go forward",
    category: "navigation",
    configurable: true,
    alternateKeys: SHORTCUTS.GO_FORWARD_ALT,
  },
  {
    id: "toggle-left-sidebar",
    keys: SHORTCUTS.TOGGLE_LEFT_SIDEBAR,
    description: "Toggle left sidebar",
    category: "navigation",
    configurable: true,
  },
  {
    id: "toggle-review-panel",
    keys: SHORTCUTS.TOGGLE_REVIEW_PANEL,
    description: "Toggle review panel",
    category: "navigation",
    configurable: true,
  },
  {
    id: "switch-tab",
    keys: "ctrl+1-9",
    description: "Switch to tab 1-9",
    category: "panels",
    context: "Task detail",
  },
  {
    id: "close-tab",
    keys: SHORTCUTS.CLOSE_TAB,
    description: "Close active tab",
    category: "panels",
    context: "Task detail",
    configurable: true,
  },
  {
    id: "open-in-editor",
    keys: SHORTCUTS.OPEN_IN_EDITOR,
    description: "Open in external editor",
    category: "panels",
    context: "Task detail",
    configurable: true,
  },
  {
    id: "copy-path",
    keys: SHORTCUTS.COPY_PATH,
    description: "Copy file path",
    category: "panels",
    context: "Task detail",
    configurable: true,
  },
  {
    id: "toggle-focus",
    keys: SHORTCUTS.TOGGLE_FOCUS,
    description: "Toggle focus mode",
    category: "panels",
    context: "Task detail (worktree)",
    configurable: true,
  },
  {
    id: "find-in-conversation",
    keys: SHORTCUTS.FIND_IN_CONVERSATION,
    description: "Find in conversation",
    category: "panels",
    context: "Task detail",
  },
  {
    id: "file-picker",
    keys: SHORTCUTS.FILE_PICKER,
    description: "Open file picker",
    category: "panels",
    context: "Task detail",
    configurable: true,
  },
  {
    id: "message-prev",
    keys: SHORTCUTS.MESSAGE_PREV,
    description: "Previous message",
    category: "panels",
    context: "Task detail",
  },
  {
    id: "message-next",
    keys: SHORTCUTS.MESSAGE_NEXT,
    description: "Next message",
    category: "panels",
    context: "Task detail",
  },
  {
    id: "message-jump",
    keys: SHORTCUTS.MESSAGE_JUMP,
    description: "Jump to message",
    category: "panels",
    context: "Task detail",
  },
  {
    id: "paste-as-file",
    keys: SHORTCUTS.PASTE_AS_FILE,
    description: "Paste as file attachment",
    category: "editor",
    context: "Message editor",
    configurable: true,
  },
  {
    id: "prompt-history-prev",
    keys: "up",
    description: "Previous prompt (when input is empty)",
    category: "editor",
    context: "Message editor",
    configurable: true,
  },
  {
    id: "prompt-history-next",
    keys: "down",
    description: "Next prompt (when input is empty)",
    category: "editor",
    context: "Message editor",
    configurable: true,
  },
  {
    id: "editor-bold",
    keys: "mod+b",
    description: "Bold",
    category: "editor",
    context: "Rich text editor",
  },
  {
    id: "editor-italic",
    keys: "mod+i",
    description: "Italic",
    category: "editor",
    context: "Rich text editor",
  },
  {
    id: "editor-underline",
    keys: "mod+u",
    description: "Underline",
    category: "editor",
    context: "Rich text editor",
  },
  {
    id: "editor-code",
    keys: "mod+e",
    description: "Inline code",
    category: "editor",
    context: "Rich text editor",
  },
];

export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  general: "General",
  navigation: "Navigation",
  panels: "Panels & Tabs",
  editor: "Editor",
};

export const CONFIGURABLE_SHORTCUT_IDS = [
  "command-menu",
  "new-task",
  "settings",
  "shortcuts",
  "inbox",
  "prev-task",
  "next-task",
  "space-up",
  "space-down",
  "go-back",
  "go-forward",
  "toggle-left-sidebar",
  "toggle-review-panel",
  "close-tab",
  "open-in-editor",
  "copy-path",
  "toggle-focus",
  "file-picker",
  "paste-as-file",
  "prompt-history-prev",
  "prompt-history-next",
] as const;

export type ConfigurableShortcutId = (typeof CONFIGURABLE_SHORTCUT_IDS)[number];

export const DEFAULT_KEYBINDINGS: Record<ConfigurableShortcutId, string> = {
  "command-menu": SHORTCUTS.COMMAND_MENU,
  "new-task": SHORTCUTS.NEW_TASK,
  settings: SHORTCUTS.SETTINGS,
  shortcuts: SHORTCUTS.SHORTCUTS_SHEET,
  inbox: SHORTCUTS.INBOX,
  "prev-task": SHORTCUTS.PREV_TASK,
  "next-task": SHORTCUTS.NEXT_TASK,
  "space-up": SHORTCUTS.SPACE_UP,
  "space-down": SHORTCUTS.SPACE_DOWN,
  "go-back": SHORTCUTS.GO_BACK,
  "go-forward": SHORTCUTS.GO_FORWARD,
  "toggle-left-sidebar": SHORTCUTS.TOGGLE_LEFT_SIDEBAR,
  "toggle-review-panel": SHORTCUTS.TOGGLE_REVIEW_PANEL,
  "close-tab": SHORTCUTS.CLOSE_TAB,
  "open-in-editor": SHORTCUTS.OPEN_IN_EDITOR,
  "copy-path": SHORTCUTS.COPY_PATH,
  "toggle-focus": SHORTCUTS.TOGGLE_FOCUS,
  "file-picker": SHORTCUTS.FILE_PICKER,
  "paste-as-file": SHORTCUTS.PASTE_AS_FILE,
  "prompt-history-prev": "shift+up",
  "prompt-history-next": "shift+down",
};

export function getShortcutsByCategory(): Record<
  ShortcutCategory,
  KeyboardShortcut[]
> {
  const grouped: Record<ShortcutCategory, KeyboardShortcut[]> = {
    general: [],
    navigation: [],
    panels: [],
    editor: [],
  };
  for (const shortcut of KEYBOARD_SHORTCUTS) {
    grouped[shortcut.category].push(shortcut);
  }
  return grouped;
}

function buildModifierParts(e: KeyboardEvent): string[] {
  const parts: string[] = [];
  if (e.metaKey) parts.push("mod");
  // On Mac, Ctrl is a distinct key (⌃), not the same as Cmd (mod). On Windows/Linux,
  // Ctrl maps to mod since there is no meta key.
  if (e.ctrlKey) parts.push(isMac ? "ctrl" : "mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  // Deduplicate — on Windows, metaKey+ctrlKey would both produce "mod"
  return [...new Set(parts)];
}

export function eventToCombo(e: KeyboardEvent): string | null {
  const bare = ["Meta", "Control", "Shift", "Alt"];
  if (bare.includes(e.key)) return null;
  if (!(e.metaKey || e.ctrlKey || e.altKey)) return null;

  const parts = buildModifierParts(e);
  // Normalize "ArrowUp" → "up", "ArrowDown" → "down", etc. to match stored bindings.
  parts.push(e.key.toLowerCase().replace(/^arrow/, ""));
  return parts.join("+");
}

/**
 * Like eventToCombo but also accepts shift-only combos (no ctrl/meta/alt required).
 * Used inside Tiptap's handleKeyDown to match bindings such as "shift+up".
 */
export function tiptapEventToCombo(e: KeyboardEvent): string | null {
  const bare = ["Meta", "Control", "Shift", "Alt"];
  if (bare.includes(e.key)) return null;
  if (!(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)) return null;

  const parts = buildModifierParts(e);
  parts.push(e.key.toLowerCase().replace(/^arrow/, ""));
  return parts.join("+");
}

/**
 * Like eventToCombo but also returns partial combos for bare modifier presses.
 * Used in the inline shortcut recorder to show live combo feedback.
 * Requires at least one of Cmd/Ctrl/Alt — shift alone is not a valid leading modifier.
 */
export function recordingEventToCombo(
  e: KeyboardEvent,
): { combo: string; isPartial: boolean } | null {
  if (!e.metaKey && !e.ctrlKey && !e.altKey) return null;
  // On Windows, the Windows key fires e.metaKey without e.ctrlKey. It maps to the
  // same "mod" token as Ctrl (both display as "Ctrl"), which is confusing. OS also
  // intercepts most Win+letter combos before they reach the app, so block it here.
  if (!isMac && e.metaKey && !e.ctrlKey) return null;

  const bare = ["Meta", "Control", "Shift", "Alt"];
  const parts = buildModifierParts(e);

  if (bare.includes(e.key)) {
    // Only modifier keys pressed so far — partial combo
    return { combo: parts.join("+"), isPartial: true };
  }

  parts.push(e.key.toLowerCase().replace(/^arrow/, ""));
  return { combo: parts.join("+"), isPartial: false };
}

function formatKey(key: string): string {
  const k = key.trim().toLowerCase();
  if (k === "mod") return isMac ? "⌘" : "Ctrl";
  if (k === "shift") return isMac ? "⇧" : "Shift";
  if (k === "alt") return isMac ? "⌥" : "Alt";
  if (k === "ctrl") return isMac ? "⌃" : "Ctrl";
  if (k === "enter") return isMac ? "↩" : "Enter";
  if (k === "escape" || k === "esc") return "Esc";
  if (k === "up" || k === "arrowup") return "↑";
  if (k === "down" || k === "arrowdown") return "↓";
  if (k === "left" || k === "arrowleft") return "←";
  if (k === "right" || k === "arrowright") return "→";
  if (k === ",") return ",";
  if (k === "[") return "[";
  if (k === "]") return "]";
  if (k === "=") return "+";
  if (k === "-") return "-";
  if (k === "tab") return "Tab";
  return k.toUpperCase();
}

function extractHotkey(keys: string): string {
  if (keys.includes(",") && !keys.endsWith(",")) {
    return keys.split(",")[0];
  }
  return keys;
}

export function formatHotkey(keys: string): string {
  const hotkey = extractHotkey(keys);
  return hotkey
    .split("+")
    .map(formatKey)
    .join(isMac ? "" : "+");
}

export function formatHotkeyParts(keys: string): string[] {
  const hotkey = extractHotkey(keys);
  return hotkey.split("+").map(formatKey);
}
