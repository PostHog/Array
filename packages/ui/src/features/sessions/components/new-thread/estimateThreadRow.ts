import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import type { ThreadRow } from "@posthog/ui/features/sessions/components/new-thread/buildThreadGroups";
import type { ToolCallContent } from "@posthog/ui/features/sessions/types";

// Ballpark row heights (px) for the virtualizer's estimateSize; a real measure
// replaces them on mount. Tuned to the 750px content column: ~95 chars per
// 22px line.
const CHARS_PER_LINE = 95;
const LINE_HEIGHT = 22;
// itemClassName py-1.5 (6px top + bottom) wrapping every row.
const ROW_PADDING = 12;
// An edit tool call (EditToolView) renders its diff expanded by default, so the
// body dominates the row. The unified diff collapses unchanged context, so its
// height tracks the changed lines plus a few context lines per hunk, not the
// whole file. CodePreview caps it at maxHeight 700px; a diff line is ~20px tall.
const TOOL_ROW_HEADER = 36;
const DIFF_LINE_HEIGHT = 20;
const DIFF_MAX_HEIGHT = 700;
const DIFF_CONTEXT_LINES = 8;

function estimateTextHeight(text: string): number {
  let lines = 0;
  for (const segment of text.split("\n")) {
    lines += Math.max(1, Math.ceil(segment.length / CHARS_PER_LINE));
  }
  return ROW_PADDING + Math.max(1, lines) * LINE_HEIGHT;
}

function countLines(text: string | null | undefined): number {
  return text ? text.split("\n").length : 0;
}

// Rough changed-line count by multiset difference — ignores position, but close
// enough to size a diff without running a real one. A new file (no oldText) is
// all additions and renders in full.
function changedLineCount(
  oldText: string | null | undefined,
  newText: string,
): number {
  if (!oldText) return countLines(newText);
  const freq = new Map<string, number>();
  for (const line of oldText.split("\n")) {
    freq.set(line, (freq.get(line) ?? 0) + 1);
  }
  let added = 0;
  for (const line of newText.split("\n")) {
    const seen = freq.get(line) ?? 0;
    if (seen > 0) freq.set(line, seen - 1);
    else added++;
  }
  let removed = 0;
  for (const count of freq.values()) removed += count;
  return added + removed;
}

function estimateToolCall(content: ToolCallContent[] | undefined): number {
  const diff = content?.find(
    (c): c is Extract<ToolCallContent, { type: "diff" }> => c.type === "diff",
  );
  if (!diff) return 40;
  // Plan-file edits open collapsed (EditToolView defaultOpen={!isPlanFile}).
  if ((diff.path ?? "").includes("claude/plans/")) {
    return ROW_PADDING + TOOL_ROW_HEADER;
  }
  const lines =
    changedLineCount(diff.oldText, diff.newText) + DIFF_CONTEXT_LINES;
  const body = Math.min(lines * DIFF_LINE_HEIGHT, DIFF_MAX_HEIGHT);
  return ROW_PADDING + TOOL_ROW_HEADER + body;
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
          return estimateToolCall(update.content);
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
