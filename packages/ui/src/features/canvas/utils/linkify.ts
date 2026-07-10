const URL_PATTERN = /https?:\/\/[^\s<>]+/gi;

export interface LinkTextSegment {
  type: "text";
  text: string;
}

export interface LinkUrlSegment {
  type: "link";
  text: string;
  href: string;
}

export type LinkSegment = LinkTextSegment | LinkUrlSegment;

/**
 * Trailing punctuation reads as prose, not part of the URL; a `)` is kept only
 * when it closes a paren opened inside the URL (e.g. Wikipedia paths).
 */
function trimTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0) {
    const char = url[end - 1] as string;
    if (".,;:!?'\"]}".includes(char)) {
      end--;
      continue;
    }
    if (char === ")") {
      const body = url.slice(0, end);
      const opens = body.split("(").length - 1;
      const closes = body.split(")").length - 1;
      if (closes > opens) {
        end--;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

/** Split plain text into text and http(s) link segments, in document order. */
export function splitLinkSegments(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimTrailingPunctuation(match[0]);
    if (!url) continue;
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, index) });
    }
    segments.push({ type: "link", text: url, href: url });
    lastIndex = index + url.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }
  return segments;
}
