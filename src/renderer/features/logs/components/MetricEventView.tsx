import { BaseLogEntry } from "@features/logs/components/BaseLogEntry";
import { MetricView } from "@features/logs/components/MetricView";
import type { AgentEvent } from "@posthog/agent";
import { Box, Code } from "@radix-ui/themes";

interface MetricEventViewProps {
  event: Extract<AgentEvent, { type: "metric" }>;
}

export function MetricEventView({ event }: MetricEventViewProps) {
  return (
    <BaseLogEntry ts={event.ts} mb="3">
      <Code size="2" variant="ghost">
        metric
      </Code>
      <Box mt="1">
        <MetricView keyName={event.key} value={event.value} unit={event.unit} />
      </Box>
    </BaseLogEntry>
  );
}
