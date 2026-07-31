import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { createIncrementalChatRowGrouper } from "@posthog/ui/features/sessions/components/chat-thread/chatRowGrouping";
import { describe, expect, it } from "vitest";

function userMessage(id: string): ConversationItem {
  return { type: "user_message", id, content: id, timestamp: 1 };
}

function agentMessage(id: string): ConversationItem {
  return {
    type: "session_update",
    id,
    turnContext: {
      toolCalls: new Map(),
      childItems: new Map(),
      turnCancelled: false,
      turnComplete: false,
    },
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: id },
    },
  };
}

describe("createIncrementalChatRowGrouper", () => {
  it("reuses completed turns while rebuilding the active turn", () => {
    const grouper = createIncrementalChatRowGrouper();
    const firstItems = [userMessage("u1"), agentMessage("a1")];
    const first = grouper.update(firstItems);
    const secondItems = [...firstItems, userMessage("u2"), agentMessage("a2")];
    const second = grouper.update(secondItems);
    const third = grouper.update([...secondItems, agentMessage("a3")]);

    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(third[0]).toBe(second[0]);
    expect(third[1]).toBe(second[1]);
    expect(third.at(-1)).toMatchObject({
      type: "agent_turn",
      items: [{ id: "a2" }, { id: "a3" }],
    });
  });

  it("fully rebuilds after a non-append replacement", () => {
    const grouper = createIncrementalChatRowGrouper();
    grouper.update([userMessage("u1"), agentMessage("a1")]);

    expect(
      grouper.update([userMessage("x1"), agentMessage("x2")]),
    ).toMatchObject([
      { id: "x1" },
      { type: "agent_turn", items: [{ id: "x2" }] },
    ]);
  });

  it("replaces an optimistic boundary whose confirmed item has a new id", () => {
    const grouper = createIncrementalChatRowGrouper();
    const prefix = [userMessage("u1"), agentMessage("a1")];
    grouper.update([...prefix, userMessage("optimistic-u2")]);

    expect(
      grouper.update([
        ...prefix,
        userMessage("confirmed-u2"),
        agentMessage("a2"),
      ]),
    ).toMatchObject([
      { id: "u1" },
      { type: "agent_turn", items: [{ id: "a1" }] },
      { id: "confirmed-u2" },
      { type: "agent_turn", items: [{ id: "a2" }] },
    ]);
  });
});
