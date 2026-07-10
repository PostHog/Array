import { splitMentionSegments } from "@posthog/shared";
import { splitLinkSegments } from "@posthog/ui/features/canvas/utils/linkify";
import { Text } from "@radix-ui/themes";
import { Fragment, useMemo } from "react";

type RenderSegment =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "mention"; name: string; email: string };

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
    for (const segment of splitMentionSegments(content)) {
      if (segment.type === "mention") {
        push(
          { type: "mention", name: segment.name, email: segment.email },
          segment.text.length,
        );
      } else {
        for (const part of splitLinkSegments(segment.text)) {
          push(part, part.text.length);
        }
      }
    }
    return entries;
  }, [content]);
  const selfEmail = currentUserEmail?.toLowerCase();
  return (
    <Text size="1" className={className}>
      {segments.map(({ segment, key }) => {
        if (segment.type === "mention") {
          return (
            <span
              key={key}
              className={`rounded px-0.5 font-medium ${
                selfEmail && segment.email.toLowerCase() === selfEmail
                  ? "bg-[var(--accent-a4)] text-[var(--accent-12)]"
                  : "text-[var(--accent-11)]"
              }`}
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
    </Text>
  );
}
