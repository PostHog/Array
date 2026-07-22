/**
 * A single marker drawn on the conversation scrollbar rail, one per user message.
 *
 * `topPct` / `heightPct` position the marker within the rail as a fraction of the
 * scrollable content's total height (0–1, relative to the inner content, not the
 * viewport). The rail converts these to absolute pixels on render.
 *
 * `onClick` scrolls the conversation to this message; `label` is the first few
 * words, shown as a hover tooltip.
 */
export interface MessageRailMarker {
  /** Stable id — also used as the React key and the tooltip anchor. */
  id: string;
  /** Top offset as a fraction (0–1) of total scrollable content height. */
  topPct: number;
  /** Marker height as a fraction (0–1) of total scrollable content height. */
  heightPct: number;
  /** Tooltip text — the first few words of the message. */
  label: string;
  /** Whether this message is currently the keyboard-focused one. */
  active?: boolean;
  /** Scrolls the conversation to this message. */
  onClick: () => void;
}

/**
 * Truncate a message body to a single-line label suitable for a hover tooltip.
 * Collapses all runs of whitespace (newlines, tabs, multiple spaces) to a single
 * space, trims, and cuts with an ellipsis past `maxLength` — the same intent as
 * the `MessageJumpPicker` truncation but whitespace-normalized so indented or
 * multi-line prompts read cleanly on one line.
 */
export function truncateMessageLabel(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength)}…`;
}

/** Default cap for the rail tooltip label. */
export const MESSAGE_RAIL_LABEL_MAX_LENGTH = 80;
