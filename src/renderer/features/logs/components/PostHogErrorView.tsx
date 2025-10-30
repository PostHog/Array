import { BaseLogEntry } from "@features/logs/components/BaseLogEntry";
import type { PostHogErrorNotification } from "@posthog/agent";
import { Code } from "@radix-ui/themes";

interface PostHogErrorViewProps {
  notification: PostHogErrorNotification;
}

export function PostHogErrorView({ notification }: PostHogErrorViewProps) {
  const { _meta } = notification.params;
  const timestamp = notification.params.timestamp;
  const message = _meta.message || "Unknown error";

  return (
    <BaseLogEntry ts={timestamp}>
      <Code size="2" color="red" variant="ghost">
        Error: {message}
      </Code>
    </BaseLogEntry>
  );
}
