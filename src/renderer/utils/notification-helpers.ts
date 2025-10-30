import type { AgentNotification } from "@posthog/agent";

/**
 * Gets the timestamp from a notification, checking both params.timestamp (PostHog)
 * and _meta.timestamp (ACP extension).
 */
export function getNotificationTimestamp(
  notification: AgentNotification,
): number | undefined {
  // Check PostHog notification format
  if (
    "params" in notification &&
    notification.params &&
    "timestamp" in notification.params
  ) {
    return notification.params.timestamp as number;
  }

  // Check ACP _meta extension
  if (notification._meta?.timestamp) {
    return notification._meta.timestamp as number;
  }

  return undefined;
}
