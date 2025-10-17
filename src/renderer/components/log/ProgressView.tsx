import { Badge, Flex, Text } from "@radix-ui/themes";
import type { TaskRun } from "@shared/types";
import { BaseLogEntry } from "./BaseLogEntry";

interface ProgressViewProps {
  event: { type: "progress"; progress: TaskRun; ts: number };
  workflow?: { stages: Array<{ id: string; name: string }> } | null;
}

export function ProgressView({ event, workflow }: ProgressViewProps) {
  const { progress } = event;

  // Format status - replace underscores and capitalize first letter
  const statusLabel = progress.status
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

  // Look up stage name
  let stageName = "-";
  if (progress.current_stage && workflow?.stages) {
    const stage = workflow.stages.find((s) => s.id === progress.current_stage);
    stageName = stage?.name ?? progress.current_stage;
  }

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
        {progress.current_stage && (
          <Text size="2" color="gray">
            · {stageName}
          </Text>
        )}
      </Flex>
    </BaseLogEntry>
  );
}
