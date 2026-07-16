import type { ThreadAgentMessage } from "@posthog/core/canvas/threadTimeline";
import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";

export function agentTurns(items: ConversationItem[]): ThreadAgentMessage[] {
  const turns: ThreadAgentMessage[] = [];
  let current: ThreadAgentMessage | null = null;
  for (const item of items) {
    if (item.type === "user_message") {
      if (current) turns.push(current);
      current = null;
      continue;
    }
    if (
      item.type === "session_update" &&
      item.update.sessionUpdate === "agent_message_chunk" &&
      "content" in item.update &&
      item.update.content.type === "text" &&
      item.update.content.text.trim()
    ) {
      if (current) {
        current.text += item.update.content.text;
      } else {
        current = {
          id: item.id,
          text: item.update.content.text,
          timestamp: item.timestamp,
        };
      }
    }
  }
  if (current) turns.push(current);
  return turns;
}
