import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import type { ToolGroupItem } from "@posthog/ui/features/sessions/components/chat-thread/ToolGroup";
import type {
  AgentTurn,
  ThreadItem,
  TurnRow,
} from "@posthog/ui/features/sessions/components/chat-thread/threadVirtualization";
import { isUserInitiatedConversationItem } from "@posthog/ui/features/sessions/components/isUserInitiatedConversationItem";

type SessionUpdateItem = Extract<ConversationItem, { type: "session_update" }>;

function isToolCallItem(item: ConversationItem): item is SessionUpdateItem {
  return (
    item.type === "session_update" && item.update.sessionUpdate === "tool_call"
  );
}

/**
 * Session-updates that `SessionUpdateView` always renders as `null`. They produce no row, so they
 * must not break a contiguous tool run.
 */
const INVISIBLE_UPDATES = new Set([
  "user_message_chunk",
  "tool_call_update",
  "plan",
  "available_commands_update",
  "config_option_update",
]);

/**
 * True when an item renders nothing, so it should be transparent to tool grouping. Besides the
 * always-null updates, this covers text chunks the stream emits with empty/whitespace or non-text
 * content (a stray empty `agent_message_chunk` between two tool calls is hidden via `empty:hidden`
 * but would otherwise split the run into two ungrouped markers).
 */
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

/**
 * Collapse each contiguous run of ≥2 tool-call updates into a single `ToolGroupItem`. A run is
 * broken by any *visible* non-tool item (prose, thought, status) so groups follow reading order;
 * invisible updates (see {@link INVISIBLE_UPDATES}) are transparent and don't split a run. A lone
 * tool call passes through untouched — it stays a single marker, matching the legacy thread.
 */
export function groupToolRuns(items: ConversationItem[]): ThreadItem[] {
  const out: ThreadItem[] = [];
  // The buffer holds the active run: tool items plus any invisible items interleaved with them.
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
      // Don't break the run; carry it along (it renders nothing wherever it lands).
      buffer.push(item);
    } else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out;
}

/**
 * Collapse each contiguous run of non-user rows into one {@link AgentTurn}, broken only by a
 * user-initiated row (which stays standalone so it remains the scroll anchor for the sticky header
 * and auto-follow). The turn block renders as a single muted card, tightening the spacing between
 * the agent's successive replies and tool calls.
 */
export function groupIntoTurns(rows: ThreadItem[]): TurnRow[] {
  const out: TurnRow[] = [];
  let buffer: ThreadItem[] = [];
  const flush = () => {
    if (buffer.length > 0) {
      out.push({ type: "agent_turn", id: buffer[0].id, items: buffer });
      buffer = [];
    }
  };
  for (const row of rows) {
    // git_action and skill_button_action stand in for the user's message when the prompt was a
    // git operation or a skill button click (see handlePromptRequest) — they open a turn just
    // like a user message, so they break the agent card too rather than render inside it as if
    // they were agent output. Same boundary set as the legacy view's buildThreadGroups.
    if (isUserInitiatedConversationItem(row)) {
      flush();
      out.push(row);
    } else {
      buffer.push(row);
    }
  }
  flush();
  return out;
}

function sameMembers<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * `groupIntoTurns(groupToolRuns(items))` with wrapper identity preserved across calls: a
 * `tool_group` or `agent_turn` whose member items are all reference-equal to the previous call's
 * reuses the previous wrapper object.
 *
 * This is what lets the memoized thread rows actually skip work during streaming. The conversation
 * builder freezes completed turns (their items keep identity) and clones every active-turn row per
 * streamed chunk, so with fresh wrappers each call the row memos miss for the *entire* transcript
 * on every chunk — a full-thread reconcile per token. With reuse, identity churn is confined to the
 * live turn, and per-chunk render work tracks the active turn like the legacy thread's
 * `createIncrementalThreadGrouper` path.
 *
 * Reuse is decided per wrapper by member identity, never by position, so steering, optimistic
 * message swaps, and interruptions degrade to rebuilding the affected wrappers rather than
 * rendering stale content.
 */
export function createStableTurnGrouper() {
  let previousGroups = new Map<string, ToolGroupItem>();
  let previousTurns = new Map<string, AgentTurn>();

  const update = (items: ConversationItem[]): TurnRow[] => {
    const nextGroups = new Map<string, ToolGroupItem>();
    const threadItems = groupToolRuns(items).map((row): ThreadItem => {
      if (row.type !== "tool_group") return row;
      const previous = previousGroups.get(row.id);
      const reused =
        previous && sameMembers(previous.tools, row.tools) ? previous : row;
      nextGroups.set(reused.id, reused);
      return reused;
    });

    const nextTurns = new Map<string, AgentTurn>();
    const rows = groupIntoTurns(threadItems).map((row): TurnRow => {
      if (row.type !== "agent_turn") return row;
      const previous = previousTurns.get(row.id);
      const reused =
        previous && sameMembers(previous.items, row.items) ? previous : row;
      nextTurns.set(reused.id, reused);
      return reused;
    });

    previousGroups = nextGroups;
    previousTurns = nextTurns;
    return rows;
  };

  return { update };
}
