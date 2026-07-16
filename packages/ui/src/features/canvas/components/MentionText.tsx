import { splitMentionSegments } from "@posthog/shared";
import { splitLinkSegments } from "@posthog/ui/features/canvas/utils/linkify";
import { Fragment, useMemo } from "react";
import "./mention-chip.css";

type RenderSegment =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "agent"; text: string }
  | { type: "mention"; name: string; email: string };

// The plain (not-the-viewer) mention chip look, also used by surfaces that
// render a mention-styled name without real mention semantics (e.g. the
// channel feed's "started a new task" row).
export const mentionChipClass = "mention-chip";

/**
 * Thread message content with inline mention tokens rendered as highlighted
 * `@Name` chips (a mention of the viewer gets the stronger treatment) and
 * bare URLs rendered as links.
 */
export function MentionText({
  content,
  currentUserEmail,
  className,
}: {
  content: string;
  currentUserEmail?: string | null;
  className?: string;
}) {
  // Key each segment by its character offset — stable for a given content.
  const segments = useMemo(() => {
    let offset = 0;
    const entries: Array<{ segment: RenderSegment; key: string }> = [];
    const push = (segment: RenderSegment, length: number) => {
      entries.push({ segment, key: `${offset}` });
      offset += length;
    };
    const pushText = (text: string) => {
      let cursor = 0;
      for (const match of text.matchAll(/(^|\s)(@agent)\b/gi)) {
        const mentionStart = (match.index ?? 0) + match[1].length;
        for (const part of splitLinkSegments(
          text.slice(cursor, mentionStart),
        )) {
          push(part, part.text.length);
        }
        push({ type: "agent", text: match[2] }, match[2].length);
        cursor = mentionStart + match[2].length;
      }
      for (const part of splitLinkSegments(text.slice(cursor))) {
        push(part, part.text.length);
      }
    };
    for (const segment of splitMentionSegments(content)) {
      if (segment.type === "mention") {
        push(
          { type: "mention", name: segment.name, email: segment.email },
          segment.text.length,
        );
      } else {
        pushText(segment.text);
      }
    }
    return entries;
  }, [content]);
  const selfEmail = currentUserEmail?.toLowerCase();
  return (
    <span className={className}>
      {segments.map(({ segment, key }) => {
        if (segment.type === "agent") {
          return (
            <span key={key} className={mentionChipClass}>
              {segment.text}
            </span>
          );
        }
        if (segment.type === "mention") {
          return (
            <span
              key={key}
              className={
                selfEmail && segment.email.toLowerCase() === selfEmail
                  ? `${mentionChipClass} mention-chip--self`
                  : mentionChipClass
              }
              title={segment.email}
            >
              @{segment.name}
            </span>
          );
        }
        if (segment.type === "link") {
          return (
            <a
              key={key}
              href={segment.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent-11)] underline underline-offset-2 hover:text-[var(--accent-12)]"
            >
              {segment.text}
            </a>
          );
        }
        return <Fragment key={key}>{segment.text}</Fragment>;
      })}
    </span>
  );
}
