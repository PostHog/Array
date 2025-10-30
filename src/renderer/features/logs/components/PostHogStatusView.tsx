import { BaseLogEntry } from "@features/logs/components/BaseLogEntry";
import type { PostHogStatusNotification } from "@posthog/agent";
import { Code } from "@radix-ui/themes";

interface PostHogStatusViewProps {
  notification: PostHogStatusNotification;
}

function formatStatusMessage(notification: PostHogStatusNotification): string {
  const { type, _meta } = notification.params;

  switch (type) {
    case "run_started":
      return `Starting task run (${_meta.isCloudMode ? "cloud" : "local"} mode)`;
    case "branch_created":
      return `Created branch: ${_meta.branch}`;
    case "phase_start":
      return `Starting ${_meta.phase} phase`;
    case "phase_complete":
      return `Completed ${_meta.phase} phase`;
    case "task_start":
      return "Task started";
    case "task_started":
      return _meta.content || "Task started in cloud";
    case "done":
      return _meta.success ? "Task completed successfully" : "Task failed";
    case "canceled":
    case "cancelled":
      return "Task canceled";
    case "permission_mode":
      return (
        _meta.content || `Permission mode: ${_meta.permissionMode || "unknown"}`
      );
    case "repo_path":
      return _meta.content || `Repository: ${_meta.repoPath || "unknown"}`;
    case "claude_stderr":
      return `[Claude] ${_meta.message}`;
    case "extraction_skipped":
      return _meta.message || "Question extraction skipped";
    default:
      // Return generic message for unknown types
      return _meta.content || _meta.message || type;
  }
}

export function PostHogStatusView({ notification }: PostHogStatusViewProps) {
  const message = formatStatusMessage(notification);
  const timestamp = notification.params.timestamp;

  if (!message) {
    return null;
  }

  return (
    <BaseLogEntry ts={timestamp}>
      <Code size="2" variant="ghost">
        {message}
      </Code>
    </BaseLogEntry>
  );
}
