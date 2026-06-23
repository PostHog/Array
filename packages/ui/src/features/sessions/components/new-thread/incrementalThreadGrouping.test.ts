import type {
  ConversationItem,
  TurnContext,
} from "@posthog/ui/features/sessions/components/buildConversationItems";
import {
  buildThreadGroups,
  type ThreadGrouping,
} from "@posthog/ui/features/sessions/components/new-thread/buildThreadGroups";
import { createIncrementalThreadGrouper } from "@posthog/ui/features/sessions/components/new-thread/incrementalThreadGrouping";
import { describe, expect, it } from "vitest";

const completeContext: TurnContext = {
  toolCalls: new Map(),
  childItems: new Map(),
  turnCancelled: false,
  turnComplete: true,
};

const activeContext: TurnContext = {
  toolCalls: new Map(),
  childItems: new Map(),
  turnCancelled: false,
  turnComplete: false,
};

function userMessage(id: string): ConversationItem {
  return {
    type: "user_message",
    id,
    content: id,
    timestamp: 1,
  };
}

function toolItem(
  id: string,
  turnContext: TurnContext = activeContext,
): ConversationItem {
  return {
    type: "session_update",
    id,
    turnContext,
    update: {
      sessionUpdate: "tool_call",
      kind: "read",
      title: "Read",
      status: turnContext.turnComplete ? "completed" : "in_progress",
    },
  };
}

function agentMessage(id: string): ConversationItem {
  return {
    type: "session_update",
    id,
    turnContext: activeContext,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: "hello",
    },
  };
}

function expectGroupingEquivalent(
  actual: ThreadGrouping,
  expected: ThreadGrouping,
) {
  expect(actual.rows).toEqual(expected.rows);
  expect(actual.keepMounted).toEqual(expected.keepMounted);
  expect([...actual.idToRowIndex.entries()]).toEqual([
    ...expected.idToRowIndex.entries(),
  ]);
}

describe("createIncrementalThreadGrouper", () => {
  it("matches a full regroup when appending to the active tool group", () => {
    const grouper = createIncrementalThreadGrouper();
    const overrides = {};
    const items = [
      userMessage("u1"),
      toolItem("t1", completeContext),
      userMessage("u2"),
      toolItem("t2"),
    ];

    grouper.update(items, "partial", overrides);

    const next = [...items, toolItem("t3")];
    expectGroupingEquivalent(
      grouper.update(next, "partial", overrides),
      buildThreadGroups(next, "partial", overrides),
    );
  });

  it("reuses the grouped prefix when appending a standalone row", () => {
    const grouper = createIncrementalThreadGrouper();
    const overrides = {};
    const items = [userMessage("u1"), toolItem("t1", completeContext)];
    const first = grouper.update(items, "partial", overrides);

    const next = [...items, agentMessage("m1")];
    const second = grouper.update(next, "partial", overrides);

    expectGroupingEquivalent(
      second,
      buildThreadGroups(next, "partial", overrides),
    );
    expect(second.rows[0]).toBe(first.rows[0]);
  });
});
