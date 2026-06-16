import type { SessionNotification } from "@agentclientprotocol/sdk";
import { APP_SERVER_NOTIFICATIONS } from "./protocol";

/**
 * Translates a native app-server notification into an ACP SessionNotification
 * so the rest of PostHog Code, which speaks ACP, stays unchanged.
 *
 * Spike scope: only the streaming agent-message path is mapped, which is what
 * Phase A proves end to end. item/tool events, token usage and approvals are
 * mapped in Phase B once the generated schema pins their exact shapes.
 * Notifications without a mapping return null and are dropped.
 */
export function mapAppServerNotification(
  sessionId: string,
  method: string,
  params: unknown,
): SessionNotification | null {
  switch (method) {
    case APP_SERVER_NOTIFICATIONS.AGENT_MESSAGE_DELTA: {
      const delta = readStringField(params, "delta");
      if (!delta) return null;
      return {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: delta },
        },
      };
    }
    default:
      return null;
  }
}

function readStringField(params: unknown, key: string): string | null {
  if (params && typeof params === "object" && key in params) {
    const value = (params as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  }
  return null;
}
