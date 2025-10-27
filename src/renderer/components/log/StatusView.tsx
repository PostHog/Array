import { BaseLogEntry } from "@components/log/BaseLogEntry";
import type { AgentEvent } from "@posthog/agent";
import { Code } from "@radix-ui/themes";

interface StatusViewProps {
  event: Extract<AgentEvent, { type: "status" }>;
}

function formatStatusMessage(
  event: Extract<AgentEvent, { type: "status" }>,
): string {
  // Guard against undefined phase
  if (!event.phase) {
    return "";
  }

  // Skip noisy internal phases
  if (event.phase === "assistant_message") {
    return "";
  }

  // Handle progress messages (from PostHog polling)
  if (event.phase.startsWith("Progress:")) {
    return event.phase;
  }

  // Format task events
  switch (event.phase) {
    case "task_start":
      return `Starting task`;
    case "branch_created":
      return `Created branch: ${event.branch || "unknown"}`;
    case "commit_made":
      return `Committed ${event.kind || "changes"}`;
    case "pr_created":
      return `Pull request: ${event.prUrl || "created"}`;
    case "canceled":
      return "Task canceled";
    default:
      // Return phase as-is for unknown types
      return event.phase;
  }
}

export function StatusView({ event }: StatusViewProps) {
  const message = formatStatusMessage(event);

  // Hide empty messages (like assistant_message)
  if (!message) {
    return null;
  }

  return (
    <BaseLogEntry ts={event.ts}>
      <Code size="2" variant="ghost">
        {message}
      </Code>
    </BaseLogEntry>
  );
}
