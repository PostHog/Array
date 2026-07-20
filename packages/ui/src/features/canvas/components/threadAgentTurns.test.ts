import { agentTurns } from "@posthog/ui/features/canvas/components/threadAgentTurns";
import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { describe, expect, it } from "vitest";

let seq = 0;

function chunk(text: string, timestamp = 1): ConversationItem {
  seq += 1;
  return {
    type: "session_update",
    id: `chunk-${seq}`,
    timestamp,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
    turnContext: {},
  } as unknown as ConversationItem;
}

function toolCall(): ConversationItem {
  seq += 1;
  return {
    type: "session_update",
    id: `tool-${seq}`,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: `t${seq}`,
      status: "in_progress",
    },
    turnContext: {},
  } as unknown as ConversationItem;
}

function userMessage(): ConversationItem {
  seq += 1;
  return {
    type: "user_message",
    id: `user-${seq}`,
    content: "go",
    timestamp: 0,
  } as unknown as ConversationItem;
}

describe("agentTurns", () => {
  it("joins streamed chunks of one sentence without inventing gaps", () => {
    expect(agentTurns([chunk("I'll prep"), chunk("are a branch.")])).toEqual([
      expect.objectContaining({ text: "I'll prepare a branch." }),
    ]);
  });

  it("breaks a paragraph where the agent stopped to run a tool", () => {
    const turns = agentTurns([
      chunk("…before committing."),
      toolCall(),
      chunk("The patch rebased cleanly."),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe(
      "…before committing.\n\nThe patch rebased cleanly.",
    );
  });

  it("breaks once for a run of tool calls, not once each", () => {
    const turns = agentTurns([
      chunk("Working."),
      toolCall(),
      toolCall(),
      toolCall(),
      chunk("Done."),
    ]);
    expect(turns[0].text).toBe("Working.\n\nDone.");
  });

  it("leaves no dangling break when a turn ends on a tool call", () => {
    const turns = agentTurns([chunk("Checking."), toolCall()]);
    expect(turns[0].text).toBe("Checking.");
  });

  it("adds no leading break when a turn opens with a tool call", () => {
    const turns = agentTurns([toolCall(), chunk("Found it.")]);
    expect(turns[0].text).toBe("Found it.");
  });

  it("starts a new turn at each user message", () => {
    const turns = agentTurns([
      chunk("First."),
      userMessage(),
      chunk("Second."),
      toolCall(),
      chunk("Third."),
    ]);
    expect(turns.map((t) => t.text)).toEqual(["First.", "Second.\n\nThird."]);
  });

  it("doesn't carry a pending break across a turn boundary", () => {
    const turns = agentTurns([
      chunk("First."),
      toolCall(),
      userMessage(),
      chunk("Second."),
    ]);
    expect(turns.map((t) => t.text)).toEqual(["First.", "Second."]);
  });

  it("ignores whitespace-only chunks", () => {
    expect(agentTurns([chunk("   "), chunk("Real.")])).toEqual([
      expect.objectContaining({ text: "Real." }),
    ]);
  });
});
