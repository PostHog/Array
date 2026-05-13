import { Badge } from "@radix-ui/themes";
import type { Schemas } from "@renderer/api/generated";

interface ScheduledTaskStatusBadgeProps {
  automation: Schemas.TaskAutomation;
}

export function ScheduledTaskStatusBadge({
  automation,
}: ScheduledTaskStatusBadgeProps) {
  if (automation.enabled === false) {
    return (
      <Badge size="1" variant="soft" color="gray">
        Paused
      </Badge>
    );
  }

  switch (automation.last_run_status) {
    case "failed":
      return (
        <Badge size="1" variant="soft" color="red">
          Failed
        </Badge>
      );
    case "success":
    case "completed":
      return (
        <Badge size="1" variant="soft" color="green">
          Healthy
        </Badge>
      );
    case "running":
    case "in_progress":
      return (
        <Badge size="1" variant="soft" color="blue">
          Running
        </Badge>
      );
    case "cancelled":
      return (
        <Badge size="1" variant="soft" color="gray">
          Cancelled
        </Badge>
      );
    default:
      return (
        <Badge size="1" variant="soft" color="blue">
          Active
        </Badge>
      );
  }
}
