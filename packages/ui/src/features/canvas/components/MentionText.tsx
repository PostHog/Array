import { splitMentionSegments } from "@posthog/shared";
import { Text } from "@radix-ui/themes";
import { Fragment, useMemo } from "react";

/**
 * Thread message content with inline mention tokens rendered as highlighted
 * `@Name` chips; a mention of the viewer gets the stronger treatment.
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
    return splitMentionSegments(content).map((segment) => {
      const entry = { segment, key: `${offset}` };
      offset += segment.text.length;
      return entry;
    });
  }, [content]);
  const selfEmail = currentUserEmail?.toLowerCase();
  return (
    <Text size="1" className={className}>
      {segments.map(({ segment, key }) =>
        segment.type === "mention" ? (
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
        ) : (
          <Fragment key={key}>{segment.text}</Fragment>
        ),
      )}
    </Text>
  );
}
