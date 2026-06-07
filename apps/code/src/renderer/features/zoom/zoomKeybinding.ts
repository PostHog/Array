export type ZoomIntent = "in" | "out" | "reset";

/**
 * Maps a keydown event to a zoom intent (or null when it's not a zoom shortcut).
 *
 * Kept as a pure function — separate from the DOM listener — because
 * react-hotkeys-hook mis-parses symbol keys, so we match `event.key` ourselves
 * and need to cover every keyboard variant:
 *   - Ctrl/Cmd + "="            -> in
 *   - Ctrl/Cmd + Shift+"=" ("+") -> in   (and numpad "+")
 *   - Ctrl/Cmd + "-"            -> out
 *   - Ctrl/Cmd + Shift+"-" ("_") -> out  (and numpad "-")
 *   - Ctrl/Cmd + "0"            -> reset (and numpad "0")
 */
export function resolveZoomIntent(
  event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "key">,
): ZoomIntent | null {
  if (!(event.ctrlKey || event.metaKey)) return null;

  switch (event.key) {
    case "=":
    case "+":
      return "in";
    case "-":
    case "_":
      return "out";
    case "0":
      return "reset";
    default:
      return null;
  }
}
