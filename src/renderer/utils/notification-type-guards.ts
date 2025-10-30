import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { AgentNotification } from "@posthog/agent";

export function isSessionNotification(
  notification: AgentNotification,
): notification is SessionNotification {
  return "sessionId" in notification && "update" in notification;
}

function getSessionUpdate(notification: AgentNotification): string | null {
  if (!isSessionNotification(notification)) return null;
  const update = notification.update;
  if (
    typeof update === "object" &&
    update !== null &&
    "sessionUpdate" in update
  ) {
    return typeof update.sessionUpdate === "string"
      ? update.sessionUpdate
      : null;
  }
  return null;
}

export function isToolCall(notification: AgentNotification): boolean {
  return getSessionUpdate(notification) === "tool_call";
}

export function isToolCallUpdate(notification: AgentNotification): boolean {
  return getSessionUpdate(notification) === "tool_call_update";
}

export function isPlan(notification: AgentNotification): boolean {
  return getSessionUpdate(notification) === "plan";
}

export function isMessageChunk(notification: AgentNotification): boolean {
  return getSessionUpdate(notification) === "agent_message_chunk";
}

export function isTerminalOutput(notification: AgentNotification): boolean {
  return (
    "method" in notification &&
    notification.method === "_posthog/terminal_output"
  );
}

export function getToolCallId(notification: AgentNotification): string | null {
  if (!isSessionNotification(notification)) return null;
  const update = notification.update;
  if (typeof update === "object" && update !== null && "toolCallId" in update) {
    return typeof update.toolCallId === "string" ? update.toolCallId : null;
  }
  return null;
}
