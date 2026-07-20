import type { ThreadAgentMessage } from "@posthog/core/canvas/threadTimeline";
import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";

/**
 * The agent's prose for each turn, as one thread message per turn.
 *
 * Text arrives as a stream of chunks, so consecutive chunks are joined raw —
 * they're mid-sentence fragments, not sentences. What does separate them is a
 * tool call: the agent says something, goes and does it, then comes back and
 * says something else. Those are two paragraphs, and gluing them together runs
 * "…before committing." straight into "The patch rebased cleanly." Rather than
 * render the call itself (the full task view does that), the thread keeps just
 * its shape: a break where the work happened.
 */
export function agentTurns(items: ConversationItem[]): ThreadAgentMessage[] {
  const turns: ThreadAgentMessage[] = [];
  let current: ThreadAgentMessage | null = null;
  // Set when a tool call lands mid-turn, and spent by the next chunk of prose —
  // so trailing calls add no dangling break, and a run of calls adds only one.
  let brokenByToolCall = false;

  for (const item of items) {
    if (item.type === "user_message") {
      if (current) turns.push(current);
      current = null;
      brokenByToolCall = false;
      continue;
    }
    if (item.type !== "session_update") continue;

    if (item.update.sessionUpdate === "tool_call") {
      // Only meaningful between two pieces of prose; a call before the agent
      // has said anything has nothing to break away from.
      if (current) brokenByToolCall = true;
      continue;
    }

    if (
      item.update.sessionUpdate === "agent_message_chunk" &&
      "content" in item.update &&
      item.update.content.type === "text" &&
      item.update.content.text.trim()
    ) {
      if (current) {
        // A blank line, not a newline: the body renders as markdown, where a
        // single newline is just a space.
        if (brokenByToolCall) {
          current.text += "\n\n";
          brokenByToolCall = false;
        }
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
