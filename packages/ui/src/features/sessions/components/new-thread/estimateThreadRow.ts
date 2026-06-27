import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import type { ThreadRow } from "@posthog/ui/features/sessions/components/new-thread/buildThreadGroups";

// Pre-measurement height guesses (px) for the conversation virtualizer. These
// only need to be in the right ballpark: the row is measured for real once it
// mounts, and the estimate's only job is to keep the first scroll-up from
// jumping as never-measured rows snap to their true height. Tuned against the
// 750px content column, so a wrapped line holds ~95 chars at ~22px tall.
const CHARS_PER_LINE = 95;
const LINE_HEIGHT = 22;
// itemClassName py-1.5 (6px top + bottom) wrapping every row.
const ROW_PADDING = 12;

function estimateTextHeight(text: string): number {
  let lines = 0;
  for (const segment of text.split("\n")) {
    lines += Math.max(1, Math.ceil(segment.length / CHARS_PER_LINE));
  }
  return ROW_PADDING + Math.max(1, lines) * LINE_HEIGHT;
}

function estimateConversationItem(item: ConversationItem): number {
  switch (item.type) {
    case "user_message": {
      const attachments = item.attachments?.length ? 72 : 0;
      return estimateTextHeight(item.content) + attachments + 16;
    }
    case "git_action":
      return 36;
    case "skill_button_action":
      return 44;
    case "git_action_result":
      return 64;
    case "turn_cancelled":
      return 40;
    case "user_shell_execute":
      return 64;
    case "session_update": {
      const update = item.update;
      switch (update.sessionUpdate) {
        case "agent_message_chunk":
        case "agent_thought_chunk":
          return update.content.type === "text"
            ? estimateTextHeight(update.content.text)
            : 40;
        case "tool_call":
          return 40;
        case "console":
          return 40;
        case "compact_boundary":
          return 48;
        case "status":
          return 32;
        case "error":
          return 64;
        case "task_notification":
          return 56;
        case "progress_group":
          return ROW_PADDING + update.steps.length * 28;
        // Rendered as null (folded into groups or invisible).
        default:
          return ROW_PADDING;
      }
    }
  }
}

/**
 * Height guess for one thread row, fed to the virtualizer's estimateSize.
 * A collapsed tool-call group is just its chip; an expanded one is the stack of
 * its items.
 */
export function estimateThreadRow(row: ThreadRow): number {
  if (row.kind === "item") return estimateConversationItem(row.item);
  if (!row.expanded) return 44;
  return (
    ROW_PADDING + row.items.reduce((h, i) => h + estimateConversationItem(i), 0)
  );
}
