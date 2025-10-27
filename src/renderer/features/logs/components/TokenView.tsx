import { BaseLogEntry } from "@features/logs/components/BaseLogEntry";
import type { AgentEvent } from "@posthog/agent";
import { Code } from "@radix-ui/themes";

interface TokenViewProps {
  event: Extract<AgentEvent, { type: "token" }>;
}

export function TokenView({ event }: TokenViewProps) {
  // Skip empty tokens
  if (!event.content || event.content.trim().length === 0) {
    return null;
  }

  return (
    <BaseLogEntry ts={event.ts}>
      <Code size="2" variant="ghost">
        {event.content}
      </Code>
    </BaseLogEntry>
  );
}
