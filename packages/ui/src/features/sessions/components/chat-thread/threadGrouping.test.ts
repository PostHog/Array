import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { describe, expect, it } from "vitest";
import {
  createStableTurnGrouper,
  groupIntoTurns,
  groupToolRuns,
} from "./threadGrouping";
import type { AgentTurn } from "./threadVirtualization";

type SessionUpdateItem = Extract<ConversationItem, { type: "session_update" }>;

function userMessage(id: string): ConversationItem {
  return { type: "user_message", id, content: `msg ${id}`, timestamp: 1 };
}

function turnContext({
  turnComplete = false,
}: {
  turnComplete?: boolean;
} = {}): SessionUpdateItem["turnContext"] {
  return {
    toolCalls: new Map(),
    childItems: new Map(),
    turnCancelled: false,
    turnComplete,
  };
}

function prose(
  id: string,
  opts?: { turnComplete?: boolean },
): SessionUpdateItem {
  return {
    type: "session_update",
    id,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `text ${id}` },
    } as SessionUpdateItem["update"],
    turnContext: turnContext(opts),
    timestamp: 1,
  };
}

function toolCall(
  id: string,
  opts?: { turnComplete?: boolean },
): SessionUpdateItem {
  return {
    type: "session_update",
    id,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: id,
      title: `tool ${id}`,
    } as unknown as SessionUpdateItem["update"],
    turnContext: turnContext(opts),
    timestamp: 1,
  };
}

function invisible(id: string): SessionUpdateItem {
  return {
    type: "session_update",
    id,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: id,
    } as unknown as SessionUpdateItem["update"],
    turnContext: turnContext(),
    timestamp: 1,
  };
}

/** The active-turn clone the conversation builder hands out per streamed chunk. */
function clone(item: SessionUpdateItem): SessionUpdateItem {
  return { ...item, turnContext: { ...item.turnContext } };
}

describe("groupToolRuns", () => {
  it("collapses a run of two or more tool calls into one group", () => {
    const [a, b, c] = [toolCall("a"), toolCall("b"), toolCall("c")];
    const rows = groupToolRuns([a, b, c]);
    expect(rows).toEqual([{ type: "tool_group", id: "a", tools: [a, b, c] }]);
  });

  it("passes a lone tool call through untouched", () => {
    const a = toolCall("a");
    expect(groupToolRuns([a])).toEqual([a]);
  });

  it("keeps a run contiguous across invisible items but breaks it on visible prose", () => {
    const [a, u, b, p, c, d] = [
      toolCall("a"),
      invisible("u"),
      toolCall("b"),
      prose("p"),
      toolCall("c"),
      toolCall("d"),
    ];
    const rows = groupToolRuns([a, u, b, p, c, d]);
    expect(rows).toEqual([
      { type: "tool_group", id: "a", tools: [a, b] },
      p,
      { type: "tool_group", id: "c", tools: [c, d] },
    ]);
  });
});

describe("groupIntoTurns", () => {
  it("wraps contiguous agent rows into one turn, broken by user-initiated rows", () => {
    const u1 = userMessage("u1");
    const a = prose("a");
    const b = prose("b");
    const git: ConversationItem = {
      type: "git_action",
      id: "g1",
      actionType: "commit" as never,
    };
    const c = prose("c");
    const rows = groupIntoTurns([u1, a, b, git, c]);
    expect(rows).toEqual([
      u1,
      { type: "agent_turn", id: "a", items: [a, b] },
      git,
      { type: "agent_turn", id: "c", items: [c] },
    ]);
  });
});

describe("createStableTurnGrouper", () => {
  it("produces the same rows as a plain groupIntoTurns(groupToolRuns(...)) pass", () => {
    const items = [
      userMessage("u1"),
      prose("a"),
      toolCall("t1"),
      toolCall("t2"),
      userMessage("u2"),
      toolCall("t3"),
    ];
    expect(createStableTurnGrouper().update(items)).toEqual(
      groupIntoTurns(groupToolRuns(items)),
    );
  });

  it("reuses turn and group wrappers when member items keep identity", () => {
    const grouper = createStableTurnGrouper();
    const frozen = [
      userMessage("u1"),
      prose("a", { turnComplete: true }),
      toolCall("t1", { turnComplete: true }),
      toolCall("t2", { turnComplete: true }),
    ];
    const first = grouper.update([
      ...frozen,
      userMessage("u2"),
      toolCall("t3"),
    ]);
    // Streamed chunk: the active turn's items are cloned, the frozen prefix keeps identity.
    const second = grouper.update([
      ...frozen,
      userMessage("u2"),
      clone(toolCall("t3")),
      clone(toolCall("t4")),
    ]);

    expect(second[1]).toBe(first[1]);
    const frozenTurn = second[1] as AgentTurn;
    expect(frozenTurn.items[1]).toBe((first[1] as AgentTurn).items[1]);
    // The active turn's wrapper is fresh — its members changed.
    expect(second[3]).not.toBe(first[3]);
  });

  it("rebuilds a group wrapper when any member is replaced", () => {
    const grouper = createStableTurnGrouper();
    const t1 = toolCall("t1");
    const t2 = toolCall("t2");
    const groupOf = (rows: ReturnType<typeof grouper.update>) =>
      (rows[0] as AgentTurn).items[0];
    const first = grouper.update([t1, t2]);
    const second = grouper.update([t1, clone(t2)]);
    expect(groupOf(second)).not.toBe(groupOf(first));
    expect(second[0]).not.toBe(first[0]);

    const stable = grouper.update([t1, t2]);
    const third = grouper.update([t1, t2]);
    expect(groupOf(third)).toBe(groupOf(stable));
    expect(third[0]).toBe(stable[0]);
  });

  it("rebuilds a group wrapper when the run grows", () => {
    const grouper = createStableTurnGrouper();
    const t1 = toolCall("t1");
    const t2 = toolCall("t2");
    const first = grouper.update([t1, t2]);
    const second = grouper.update([t1, t2, toolCall("t3")]);
    expect((second[0] as AgentTurn).items[0]).not.toBe(
      (first[0] as AgentTurn).items[0],
    );
  });
});
