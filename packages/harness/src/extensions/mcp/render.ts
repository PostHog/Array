/**
 * Custom `renderCall` for bridged MCP tools. pi's fallback renderer shows
 * only the tool name, which hides the arguments the model actually sent —
 * exactly what you need to see when a call fails (wrong id, missing field).
 * Collapsed: name + compact single-line JSON (truncated). Expanded: full
 * pretty-printed arguments.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const MAX_COLLAPSED_ARGS_LENGTH = 120;

/** Compact single-line JSON preview of tool arguments. Empty for no args. */
export function formatArgsCompact(
  args: unknown,
  maxLength = MAX_COLLAPSED_ARGS_LENGTH,
): string {
  if (args === undefined || args === null) return "";
  let json: string;
  try {
    json = JSON.stringify(args) ?? "";
  } catch {
    json = String(args);
  }
  if (json === "" || json === "{}") return "";
  return json.length > maxLength ? `${json.slice(0, maxLength - 1)}…` : json;
}

/** Full pretty-printed arguments for the expanded view. Empty for no args. */
export function formatArgsExpanded(args: unknown): string {
  if (args === undefined || args === null) return "";
  let json: string;
  try {
    json = JSON.stringify(args, null, 2) ?? "";
  } catch {
    json = String(args);
  }
  return json === "" || json === "{}" ? "" : json;
}

export function renderMcpToolCall(
  piName: string,
  args: unknown,
  theme: Theme,
  expanded: boolean,
): InstanceType<typeof Text> {
  let text = theme.fg("toolTitle", theme.bold(piName));
  if (expanded) {
    const pretty = formatArgsExpanded(args);
    if (pretty) {
      text += `\n${pretty
        .split("\n")
        .map((line) => theme.fg("dim", line))
        .join("\n")}`;
    }
  } else {
    const compact = formatArgsCompact(args);
    if (compact) text += ` ${theme.fg("muted", compact)}`;
  }
  return new Text(text, 0, 0);
}
