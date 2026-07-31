import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import type { ToolGroupItem } from "@posthog/ui/features/sessions/components/chat-thread/ToolGroup";

export type ThreadItem = ConversationItem | ToolGroupItem;
export type AgentTurn = { type: "agent_turn"; id: string; items: ThreadItem[] };

export type TurnRow = ThreadItem | AgentTurn;

type SessionUpdateItem = Extract<ConversationItem, { type: "session_update" }>;

function isToolCallItem(item: ConversationItem): item is SessionUpdateItem {
  return (
    item.type === "session_update" && item.update.sessionUpdate === "tool_call"
  );
}

const INVISIBLE_UPDATES = new Set([
  "user_message_chunk",
  "tool_call_update",
  "plan",
  "available_commands_update",
  "config_option_update",
]);

function isInvisibleItem(item: ConversationItem): boolean {
  if (item.type !== "session_update") return false;
  const update = item.update;
  if (INVISIBLE_UPDATES.has(update.sessionUpdate)) return true;
  if (
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk"
  ) {
    return update.content.type !== "text" || update.content.text.trim() === "";
  }
  return false;
}

function groupToolRuns(items: ConversationItem[]): ThreadItem[] {
  const out: ThreadItem[] = [];
  let buffer: ConversationItem[] = [];
  let toolCount = 0;

  const flush = () => {
    if (toolCount >= 2) {
      const tools = buffer.filter(isToolCallItem);
      out.push({ type: "tool_group", id: tools[0].id, tools });
    } else {
      out.push(...buffer);
    }
    buffer = [];
    toolCount = 0;
  };

  for (const item of items) {
    if (isToolCallItem(item)) {
      buffer.push(item);
      toolCount++;
    } else if (isInvisibleItem(item)) {
      buffer.push(item);
    } else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out;
}

function groupIntoTurns(rows: ThreadItem[]): TurnRow[] {
  const out: TurnRow[] = [];
  let buffer: ThreadItem[] = [];
  const flush = () => {
    if (buffer.length > 0) {
      out.push({ type: "agent_turn", id: buffer[0].id, items: buffer });
      buffer = [];
    }
  };
  for (const row of rows) {
    if (
      row.type === "user_message" ||
      row.type === "git_action" ||
      row.type === "skill_button_action"
    ) {
      flush();
      out.push(row);
    } else {
      buffer.push(row);
    }
  }
  flush();
  return out;
}

export function createIncrementalChatRowGrouper() {
  let cachedItems: ConversationItem[] = [];
  let cachedRows: TurnRow[] = [];

  return {
    update(items: ConversationItem[]): TurnRow[] {
      if (items === cachedItems) return cachedRows;

      let rebuildStart = 0;
      for (let index = items.length - 1; index >= 0; index--) {
        const item = items[index];
        if (
          item.type === "user_message" ||
          item.type === "git_action" ||
          item.type === "skill_button_action"
        ) {
          rebuildStart = index;
          break;
        }
      }

      // The builder replaces rows in place anywhere in the list (a status
      // completing, a shell result arriving, a thought settling), so every
      // retained item must be identity-checked — pointer compares, cheap.
      for (let i = 0; i < rebuildStart; i++) {
        if (cachedItems[i] !== items[i]) {
          rebuildStart = 0;
          break;
        }
      }

      let boundaryId = items[rebuildStart]?.id;
      let cachedBoundaryIndex = boundaryId
        ? cachedRows.findIndex((row) => row.id === boundaryId)
        : -1;
      if (
        rebuildStart > 0 &&
        rebuildStart < cachedItems.length &&
        cachedBoundaryIndex < 0
      ) {
        rebuildStart = 0;
        boundaryId = items[0]?.id;
        cachedBoundaryIndex = boundaryId
          ? cachedRows.findIndex((row) => row.id === boundaryId)
          : -1;
      }
      const prefixRowCount =
        rebuildStart === 0
          ? 0
          : cachedBoundaryIndex >= 0
            ? cachedBoundaryIndex
            : cachedRows.length;
      const suffixRows = groupIntoTurns(
        groupToolRuns(items.slice(rebuildStart)),
      );
      cachedItems = items;
      cachedRows = [...cachedRows.slice(0, prefixRowCount), ...suffixRows];
      return cachedRows;
    },
  };
}
