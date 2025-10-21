import { Badge, Flex } from "@radix-ui/themes";
import type { TaskRun } from "@shared/types";
import { BaseLogEntry } from "./BaseLogEntry";

interface ProgressViewProps {
  event: { type: "progress"; progress: TaskRun; ts: number };
}

export function ProgressView({ event }: ProgressViewProps) {
  const { progress } = event;

  // Format status - replace underscores and capitalize first letter
  const statusLabel = progress.status
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

  // Color based on status
  const statusColor = {
    started: "blue",
    in_progress: "blue",
    completed: "green",
    failed: "red",
  }[progress.status] as "blue" | "green" | "red" | undefined;

  return (
    <BaseLogEntry ts={event.ts}>
      <Flex gap="2" align="center">
        <Badge color={statusColor} variant="soft" size="1">
          {statusLabel}
        </Badge>
      </Flex>
    </BaseLogEntry>
  );
}
