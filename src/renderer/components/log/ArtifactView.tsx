import type { AgentEvent } from "@posthog/agent";
import { Code } from "@radix-ui/themes";
import { BaseLogEntry } from "./BaseLogEntry";

interface ArtifactViewProps {
  event: Extract<AgentEvent, { type: "artifact" }>;
}

export function ArtifactView({ event }: ArtifactViewProps) {
  return (
    <BaseLogEntry ts={event.ts}>
      <Code size="2" variant="ghost">
        artifact: {event.kind}
      </Code>
    </BaseLogEntry>
  );
}
