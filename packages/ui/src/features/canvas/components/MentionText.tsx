import { splitMentionSegments } from "@posthog/shared";
import { Text } from "@radix-ui/themes";
import { useMemo } from "react";

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
  const segments = useMemo(() => splitMentionSegments(content), [content]);
  const selfEmail = currentUserEmail?.toLowerCase();
  return (
    <Text size="1" className={className}>
      {segments.map((segment, index) =>
        segment.type === "mention" ? (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
            key={index}
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
          segment.text
        ),
      )}
    </Text>
  );
}
