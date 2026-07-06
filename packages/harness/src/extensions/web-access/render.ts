/**
 * Custom `renderCall` for `web_search`/`web_fetch` so the tool call header
 * shows the query/URL being requested instead of a bare `web_search` /
 * `web_fetch` label.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const MAX_PREVIEW_LENGTH = 80;

function truncate(text: string, max = MAX_PREVIEW_LENGTH): string {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}

export function renderWebSearchCall(
  args: { query?: string; search_context_size?: string },
  theme: Theme,
): InstanceType<typeof Text> {
  const query = args?.query;
  let text = theme.fg("toolTitle", theme.bold("web_search"));
  text += query
    ? ` ${theme.fg("accent", truncate(query))}`
    : ` ${theme.fg("muted", "...")}`;
  if (args?.search_context_size) {
    text += theme.fg("dim", ` (${args.search_context_size})`);
  }
  return new Text(text, 0, 0);
}

export function renderWebFetchCall(
  args: { url?: string; prompt?: string },
  theme: Theme,
): InstanceType<typeof Text> {
  const url = args?.url;
  let text = theme.fg("toolTitle", theme.bold("web_fetch"));
  text += url
    ? ` ${theme.fg("accent", truncate(url))}`
    : ` ${theme.fg("muted", "...")}`;
  if (args?.prompt) {
    text += `\n  ${theme.fg("dim", truncate(args.prompt))}`;
  }
  return new Text(text, 0, 0);
}
