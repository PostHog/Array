/// <reference path="../../../types/joplin-turndown-plugin-gfm.d.ts" />
import { gfm } from "@joplin/turndown-plugin-gfm";
import TurndownService from "turndown";

let turndown: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (turndown) return turndown;
  turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  turndown.use(gfm); // tables, strikethrough, task lists
  return turndown;
}

/** Convert clipboard HTML to Markdown. Returns null when it adds nothing over the plain-text fallback. */
export function htmlToMarkdown(
  html: string,
  plainTextFallback?: string,
): string | null {
  const markdown = getTurndown().turndown(html).trim();
  if (!markdown) return null;

  // No formatting beyond the plain text; defer to the default paste.
  if (
    plainTextFallback !== undefined &&
    markdown === plainTextFallback.trim()
  ) {
    return null;
  }

  return markdown;
}
