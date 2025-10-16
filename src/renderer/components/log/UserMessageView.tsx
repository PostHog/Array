import type { AgentEvent } from "@posthog/agent";
import { Code } from "@radix-ui/themes";
import { BaseLogEntry } from "@renderer/components/log/BaseLogEntry";

interface UserMessageViewProps {
  event: Extract<AgentEvent, { type: "user_message" }>;
}

export function UserMessageView({ event }: UserMessageViewProps) {
  return (
    <BaseLogEntry ts={event.ts}>
      <Code size="2" color="blue" variant="ghost">
        user: {event.content}
      </Code>
    </BaseLogEntry>
  );
}
