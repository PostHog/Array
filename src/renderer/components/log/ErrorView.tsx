import type { AgentEvent } from "@posthog/agent";
import { Code } from "@radix-ui/themes";
import { BaseLogEntry } from "./BaseLogEntry";

interface ErrorViewProps {
  event: Extract<AgentEvent, { type: "error" }>;
}

export function ErrorView({ event }: ErrorViewProps) {
  return (
    <BaseLogEntry ts={event.ts}>
      <Code size="2" color="red" variant="ghost">
        error: {event.message}
      </Code>
    </BaseLogEntry>
  );
}
