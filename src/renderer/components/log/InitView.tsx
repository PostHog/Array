import { BaseLogEntry } from "@components/log/BaseLogEntry";
import type { AgentEvent } from "@posthog/agent";
import { Box, Code } from "@radix-ui/themes";

interface InitViewProps {
  event: Extract<AgentEvent, { type: "init" }>;
}

export function InitView({ event }: InitViewProps) {
  return (
    <BaseLogEntry ts={event.ts}>
      <Box>
        <Code size="2" variant="ghost">
          Initialized
        </Code>
        <Box mt="1">
          <Code size="1" color="gray" variant="ghost">
            Model: {event.model} | Permission: {event.permissionMode} | Tools:{" "}
            {event.tools.length}
          </Code>
        </Box>
        <Box>
          <Code size="1" color="gray" variant="ghost">
            Working directory: {event.cwd}
          </Code>
        </Box>
      </Box>
    </BaseLogEntry>
  );
}
