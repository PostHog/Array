import type { SessionNotification } from "@agentclientprotocol/sdk";
import { BaseLogEntry } from "@features/logs/components/BaseLogEntry";
import { PostHogArtifactView } from "@features/logs/components/PostHogArtifactView";
import { PostHogErrorView } from "@features/logs/components/PostHogErrorView";
import { PostHogStatusView } from "@features/logs/components/PostHogStatusView";
import type {
  AgentNotification,
  PostHogArtifactNotification,
  PostHogErrorNotification,
  PostHogStatusNotification,
} from "@posthog/agent";
import { Code, Flex, Text } from "@radix-ui/themes";
import { getNotificationTimestamp } from "@utils/notification-helpers";

interface AgentNotificationRendererProps {
  notification: AgentNotification;
  index: number;
}

function isPostHogNotification(
  notification: AgentNotification,
): notification is Extract<AgentNotification, { method: string }> {
  return "method" in notification && typeof notification.method === "string";
}

function isSessionNotification(
  notification: AgentNotification,
): notification is SessionNotification {
  return (
    "sessionId" in notification &&
    "update" in notification &&
    typeof notification.sessionId === "string"
  );
}

export function AgentNotificationRenderer({
  notification,
  index,
}: AgentNotificationRendererProps) {
  // Extract timestamp from notification
  const timestamp = getNotificationTimestamp(notification) ?? Date.now();

  // Handle PostHog notifications
  if (isPostHogNotification(notification)) {
    const { method } = notification;

    // Route to specialized view components based on method
    switch (method) {
      case "_posthog/status":
        return (
          <PostHogStatusView
            key={`posthog-status-${index}`}
            notification={notification as PostHogStatusNotification}
          />
        );
      case "_posthog/artifact":
        return (
          <PostHogArtifactView
            key={`posthog-artifact-${index}`}
            notification={notification as PostHogArtifactNotification}
          />
        );
      case "_posthog/error":
        return (
          <PostHogErrorView
            key={`posthog-error-${index}`}
            notification={notification as PostHogErrorNotification}
          />
        );
      default:
        // Unknown PostHog notification type
        return (
          <BaseLogEntry key={`posthog-unknown-${index}`} ts={timestamp}>
            <Code size="2" variant="ghost">
              Unknown PostHog notification: {method}
            </Code>
          </BaseLogEntry>
        );
    }
  }

  // Handle ACP SessionNotification
  if (isSessionNotification(notification)) {
    const { update } = notification;
    const updateType =
      "sessionUpdate" in update ? update.sessionUpdate : "unknown";

    // Skip noisy update types (handled by grouping)
    if (
      updateType === "agent_message_chunk" ||
      updateType === "tool_call" ||
      updateType === "tool_call_update" ||
      updateType === "available_commands_update" ||
      updateType === "plan"
    ) {
      return null;
    }

    // Generic ACP notification rendering for other types
    const { sessionId } = notification;
    return (
      <BaseLogEntry key={`acp-${index}`} ts={timestamp}>
        <Flex direction="column" gap="1">
          <Text size="2" weight="bold">
            ACP: {updateType}
          </Text>
          <Text size="1" color="gray">
            Session: {sessionId.slice(0, 8)}...
          </Text>
          <Code size="1" variant="ghost">
            {JSON.stringify(update, null, 2)}
          </Code>
        </Flex>
      </BaseLogEntry>
    );
  }

  // Fallback for unknown notification types
  return (
    <BaseLogEntry key={`unknown-${index}`} ts={timestamp}>
      <Code size="2" variant="ghost">
        UNKNOWN NOTIFICATION: {JSON.stringify(notification, null, 2)}
      </Code>
    </BaseLogEntry>
  );
}
