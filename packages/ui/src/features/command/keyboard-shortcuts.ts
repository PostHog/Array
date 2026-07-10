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
}

type ShortcutId = keyof typeof SHORTCUTS;

/**
 * Bindings that are implementation details rather than discoverable actions
 * (aliases folded into another shortcut's `alternateKeys`, or internal
 * escape/blur handling) -- deliberately excluded from the sheet.
 */
const HIDDEN_FROM_SHEET = [
  "GO_BACK_ALT",
  "GO_FORWARD_ALT",
  "BLUR",
  "SUBMIT_BLUR",
] as const satisfies ShortcutId[];

/**
 * Documentation for every entry in `SHORTCUTS` that's a discoverable,
 * user-facing action. This is the single source the Keyboard Shortcuts sheet
 * and the command palette both read from -- add a `SHORTCUTS` entry and this
 * map won't compile until you either document it here or add it to
 * `HIDDEN_FROM_SHEET`, so the two surfaces can't silently drift again.
 */
const SHORTCUT_META: Record<
  Exclude<ShortcutId, (typeof HIDDEN_FROM_SHEET)[number]>,
  { description: string; category: ShortcutCategory; context?: string }
> = {
  COMMAND_MENU: { description: "Open command menu", category: "general" },
  NEW_TASK: { description: "New task", category: "general" },
  NEW_TAB: {
    description: "New tab",
    category: "navigation",
    context: "Channels",
  },
  SETTINGS: { description: "Open settings", category: "general" },
  SHORTCUTS_SHEET: {
    description: "Show keyboard shortcuts",
    category: "general",
  },
  GO_BACK: { description: "Go back", category: "navigation" },
  GO_FORWARD: { description: "Go forward", category: "navigation" },
  TOGGLE_LEFT_SIDEBAR: {
    description: "Toggle left sidebar",
    category: "navigation",
  },
  TOGGLE_REVIEW_PANEL: {
    description: "Toggle review panel",
    category: "navigation",
  },
  PREV_TASK: { description: "Previous task", category: "navigation" },
  NEXT_TASK: { description: "Next task", category: "navigation" },
  CLOSE_TAB: {
    description: "Close active tab",
    category: "panels",
    context: "Task detail",
  },
  SWITCH_TAB: {
    description: "Switch to tab 1-9",
    category: "panels",
    context: "Task detail",
  },
  SWITCH_TASK: { description: "Switch to task 1-9", category: "navigation" },
  OPEN_IN_EDITOR: {
    description: "Open in external editor",
    category: "panels",
    context: "Task detail",
  },
  COPY_PATH: {
    description: "Copy file path",
    category: "panels",
    context: "Task detail",
  },
  TOGGLE_FOCUS: {
    description: "Toggle focus mode",
    category: "panels",
    context: "Task detail",
  },
  PASTE_AS_FILE: {
    description: "Paste as file attachment",
    category: "editor",
    context: "Message editor",
  },
  INBOX: { description: "Open inbox", category: "navigation" },
  SPACE_UP: { description: "Previous space", category: "navigation" },
  SPACE_DOWN: { description: "Next space", category: "navigation" },
  FIND_IN_CONVERSATION: {
    description: "Find in conversation",
    category: "panels",
    context: "Task detail",
  },
  SWITCH_MESSAGING_MODE: {
    description: "Switch Steer / Queue mode",
    category: "editor",
    context: "Session composer",
  },
  RELOAD_WINDOW: { description: "Reload window", category: "general" },
  ZOOM_IN: { description: "Zoom in", category: "general" },
  ZOOM_OUT: { description: "Zoom out", category: "general" },
  RESET_ZOOM: { description: "Reset zoom", category: "general" },
};

const ALTERNATE_KEYS: Partial<Record<ShortcutId, ShortcutId>> = {
  GO_BACK: "GO_BACK_ALT",
  GO_FORWARD: "GO_FORWARD_ALT",
};

/**
 * A handful of `SHORTCUTS` entries pack several bindings into one
 * comma-separated string (mod+1..mod+9 for task switching). The sheet shows
 * those as a single "1-9" range rather than every literal binding.
 */
const RANGE_DISPLAY_KEYS: Partial<Record<ShortcutId, string>> = {
  SWITCH_TAB: "ctrl+1-9",
  SWITCH_TASK: "mod+1-9",
};

function resolveKeys(id: ShortcutId): { keys: string; alternateKeys?: string } {
  const rangeDisplay = RANGE_DISPLAY_KEYS[id];
  if (rangeDisplay) return { keys: rangeDisplay };

  const alternateId = ALTERNATE_KEYS[id];
  if (alternateId)
    return { keys: SHORTCUTS[id], alternateKeys: SHORTCUTS[alternateId] };

  const [keys, alternateKeys] = SHORTCUTS[id].split(",");
  return { keys, alternateKeys };
}

/**
 * Bindings owned by third-party editor keymaps (Tiptap defaults, the message
 * editor's own history nav) rather than the app's `SHORTCUTS`/`useHotkeys`
 * system -- there's no single-source entry to derive these from, so they're
 * documented here by hand.
 */
const EDITOR_KEYMAP_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: "prompt-history-prev",
    keys: "up",
    description: "Previous prompt (when input is empty)",
    category: "editor",
    context: "Message editor",
  },
  {
    id: "prompt-history-next",
    keys: "down",
    description: "Next prompt (when input is empty)",
    category: "editor",
    context: "Message editor",
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

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  ...(
    Object.entries(SHORTCUT_META) as [
      keyof typeof SHORTCUT_META,
      (typeof SHORTCUT_META)[keyof typeof SHORTCUT_META],
    ][]
  ).map(([id, meta]) => ({
    id: id.toLowerCase().replaceAll("_", "-"),
    description: meta.description,
    category: meta.category,
    context: meta.context,
    ...resolveKeys(id),
  })),
  ...EDITOR_KEYMAP_SHORTCUTS,
];

export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  general: "General",
  navigation: "Navigation",
  panels: "Panels & Tabs",
  editor: "Editor",
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
