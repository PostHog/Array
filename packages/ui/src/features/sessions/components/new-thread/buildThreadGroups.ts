import type { Icon } from "@phosphor-icons/react";
import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import {
  buildDoneLabel,
  type CollapseMode,
  type GroupCounts,
  grouping,
  iconForToolKind,
  MCP_ICON,
  SUBAGENT_ICON,
} from "@posthog/ui/features/sessions/components/new-thread/conversationThreadConfig";

export interface GroupIconEntry {
  Icon: Icon;
  key: string;
}

export interface GroupSummary {
  counts: GroupCounts;
  icons: GroupIconEntry[];
  /** Title of the most recent tool — "what's happening now" while running. */
  liveLabel: string | null;
  /** Verb-led summary shown once the turn completes. */
  doneLabel: string;
}

/**
 * One rendered row of the new thread. Either a passthrough conversation item or
 * a collapsed tool-call group standing in for a run of work items.
 */
export type ThreadRow =
  | {
      kind: "item";
      id: string;
      item: ConversationItem;
    }
  | {
      kind: "tool_group";
      id: string;
      items: ConversationItem[];
      summary: GroupSummary;
      turnComplete: boolean;
      expanded: boolean;
    };

export interface ThreadGrouping {
  rows: ThreadRow[];
  /** Row indices of standalone MCP-app items, for the list's keepMounted. */
  keepMounted: number[];
  /** Every item id (incl. those folded into a group) → its row index. */
  idToRowIndex: Map<string, number>;
}

function getToolName(update: { _meta?: unknown }): string | undefined {
  const meta = update._meta as
    | { claudeCode?: { toolName?: string } }
    | undefined;
  return meta?.claudeCode?.toolName;
}

function isMcpToolItem(item: ConversationItem): boolean {
  if (item.type !== "session_update") return false;
  if (item.update.sessionUpdate !== "tool_call") return false;
  return getToolName(item.update)?.startsWith("mcp__") ?? false;
}

function isAlwaysVisibleItem(item: ConversationItem): boolean {
  return (
    item.type === "session_update" &&
    grouping.alwaysVisibleUpdates.has(item.update.sessionUpdate)
  );
}

function summarize(items: ConversationItem[]): GroupSummary {
  const counts: GroupCounts = {
    execute: 0,
    read: 0,
    edit: 0,
    delete: 0,
    move: 0,
    search: 0,
    fetch: 0,
    subagents: 0,
    other: 0,
    messages: 0,
  };
  let liveLabel: string | null = null;
  const icons: GroupIconEntry[] = [];
  const seenIcons = new Set<string>();

  const addIcon = (Icon: Icon, key: string) => {
    if (seenIcons.has(key) || icons.length >= grouping.maxIconsInChip) return;
    seenIcons.add(key);
    icons.push({ Icon, key });
  };

  for (const item of items) {
    if (item.type !== "session_update") continue;
    const update = item.update;
    if (update.sessionUpdate === "tool_call") {
      // Most recent tool's title — what the chip shows while still running.
      if (update.title) liveLabel = update.title;
      const name = getToolName(update);
      if (name && grouping.subagentToolNames.has(name)) {
        counts.subagents++;
        addIcon(SUBAGENT_ICON, "subagent");
      } else if (name?.startsWith("mcp__")) {
        counts.other++;
        addIcon(MCP_ICON, "mcp");
      } else {
        const kind = update.kind ?? null;
        switch (kind) {
          case "execute":
            counts.execute++;
            break;
          case "read":
            counts.read++;
            break;
          case "edit":
            counts.edit++;
            break;
          case "delete":
            counts.delete++;
            break;
          case "move":
            counts.move++;
            break;
          case "search":
            counts.search++;
            break;
          case "fetch":
            counts.fetch++;
            break;
          default:
            counts.other++;
            break;
        }
        addIcon(iconForToolKind(kind), `kind:${kind ?? "other"}`);
      }
    } else if (
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "console"
    ) {
      counts.messages++;
    }
  }

  return { counts, icons, liveLabel, doneLabel: buildDoneLabel(counts) };
}

// Completed turns are frozen by reference in the conversation builder, so their
// group summary never changes — cache it keyed on the group's (stable) first
// item to avoid re-walking every frozen group on every streamed token. The
// active (incomplete) turn is never cached, so its live label stays correct.
const summaryCache = new WeakMap<
  ConversationItem,
  { len: number; summary: GroupSummary }
>();

function summarizeMemo(
  leading: ConversationItem[],
  turnComplete: boolean,
): GroupSummary {
  const key = leading[0];
  if (turnComplete) {
    const cached = summaryCache.get(key);
    if (cached && cached.len === leading.length) return cached.summary;
  }
  const summary = summarize(leading);
  if (turnComplete) summaryCache.set(key, { len: leading.length, summary });
  return summary;
}

/**
 * Transform the flat conversation items into rows for the new thread, folding
 * each turn's tool-call work into a collapsible group according to the global
 * collapse mode and any per-group overrides. Emits the keepMounted indices and
 * item→row map in the same pass so callers don't re-walk the list.
 *
 * Safe to run on every render under useMemo; frozen-turn summaries are cached.
 */
export function buildThreadGroups(
  items: ConversationItem[],
  mode: CollapseMode,
  overrides: Record<string, boolean>,
): ThreadGrouping {
  const rows: ThreadRow[] = [];
  const keepMounted: number[] = [];
  const idToRowIndex = new Map<string, number>();
  let buffer: ConversationItem[] = [];

  const pushItemRow = (item: ConversationItem): number => {
    const idx = rows.length;
    rows.push({ kind: "item", id: item.id, item });
    idToRowIndex.set(item.id, idx);
    return idx;
  };

  const flush = () => {
    if (buffer.length === 0) return;
    const first = buffer[0];
    const turnComplete =
      first.type === "session_update" && first.turnContext.turnComplete;
    const groupId = `group:${first.id}`;

    // Peel the trailing assistant answer (a run of agent_message_chunks at the
    // end of the turn) out of the group so it stays visible even when collapsed.
    const leading = [...buffer];
    const trailing: ConversationItem[] = [];
    while (leading.length > 0) {
      const last = leading[leading.length - 1];
      if (
        last.type === "session_update" &&
        last.update.sessionUpdate === "agent_message_chunk"
      ) {
        trailing.unshift(leading.pop() as ConversationItem);
      } else {
        break;
      }
    }

    // Nothing collapsible (turn was only an assistant answer): render inline.
    if (leading.length === 0) {
      for (const item of buffer) pushItemRow(item);
      buffer = [];
      return;
    }

    // Base behavior from the global mode; a per-group override (true=expanded,
    // false=collapsed) wins. A chip is shown whenever the group is collapsible
    // by the mode or the user explicitly collapsed it.
    const baseCollapse = mode === "all" || (mode === "partial" && turnComplete);
    const override = overrides[groupId];
    const expanded = override ?? !baseCollapse;
    const chipPresent = baseCollapse || override === false;

    if (chipPresent) {
      // The chip owns its children (rendered inside one bordered box when
      // expanded), so they are NOT emitted as separate rows here. Their ids
      // still map to the group's row so find-in-thread can scroll to them.
      const idx = rows.length;
      rows.push({
        kind: "tool_group",
        id: groupId,
        items: leading,
        summary: summarizeMemo(leading, turnComplete),
        turnComplete,
        expanded,
      });
      for (const item of leading) idToRowIndex.set(item.id, idx);
    } else {
      for (const item of leading) pushItemRow(item);
    }
    for (const item of trailing) pushItemRow(item);
    buffer = [];
  };

  for (const item of items) {
    switch (item.type) {
      case "user_message":
      case "git_action":
      case "skill_button_action": {
        flush();
        pushItemRow(item);
        break;
      }
      case "session_update": {
        if (grouping.excludeMcpApps && isMcpToolItem(item)) {
          // Keep MCP-app tool calls standalone so their iframes stay mounted.
          flush();
          keepMounted.push(pushItemRow(item));
        } else if (isAlwaysVisibleItem(item)) {
          // Setup/clone progress and the like never collapse into a group.
          flush();
          pushItemRow(item);
        } else {
          buffer.push(item);
        }
        break;
      }
      default: {
        // git_action_result, turn_cancelled, user_shell_execute, queued —
        // standalone rows that belong to the current turn's epilogue.
        flush();
        pushItemRow(item);
        break;
      }
    }
  }
  flush();

  return { rows, keepMounted, idToRowIndex };
}
