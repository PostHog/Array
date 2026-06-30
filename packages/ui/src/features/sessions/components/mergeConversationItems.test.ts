import { describe, expect, it } from "vitest";
import type { ConversationItem } from "./buildConversationItems";
import { mergeConversationItems } from "./mergeConversationItems";

function userMessage(
  id: string,
  content: string,
  pinToTop?: boolean,
): Extract<ConversationItem, { type: "user_message" }> {
  return { type: "user_message", id, content, timestamp: 0, pinToTop };
}

describe("mergeConversationItems", () => {
  it("local: appends optimistic at the chronological end", () => {
    const result = mergeConversationItems({
      conversationItems: [userMessage("a", "first")],
      optimisticItems: [userMessage("opt", "draft")],
      isCloud: false,
    });
    expect(result.map((i) => i.id)).toEqual(["a", "opt"]);
  });

  it("local: does NOT dedupe — duplicate echoes are intentionally retained", () => {
    const result = mergeConversationItems({
      conversationItems: [userMessage("echo", "hello")],
      optimisticItems: [userMessage("opt", "hello")],
      isCloud: false,
    });
    expect(result.map((i) => i.id)).toEqual(["echo", "opt"]);
  });

  it("cloud: pins optimistic at the top", () => {
    const result = mergeConversationItems({
      conversationItems: [userMessage("setup", "setup info")],
      optimisticItems: [userMessage("opt", "draft")],
      isCloud: true,
    });
    expect(result.map((i) => i.id)).toEqual(["opt", "setup"]);
  });

  it("cloud: filters echoed user_message that matches optimistic content", () => {
    const result = mergeConversationItems({
      conversationItems: [
        userMessage("echo", "hello"),
        userMessage("other", "different"),
      ],
      optimisticItems: [userMessage("opt", "hello")],
      isCloud: true,
    });
    expect(result.map((i) => i.id)).toEqual(["opt", "other"]);
  });

  it("cloud: dedupes the echoed prompt even when it carries an appended channel CONTEXT.md", () => {
    const echoedWithContext =
      'hello\n\n<channel_context channel="bluebird">background</channel_context>';
    const result = mergeConversationItems({
      conversationItems: [
        userMessage("echo", echoedWithContext),
        userMessage("other", "different"),
      ],
      optimisticItems: [userMessage("opt", "hello")],
      isCloud: true,
    });
    // No duplicate: the echo is dropped...
    expect(result.map((i) => i.id)).toEqual(["opt", "other"]);
    // ...and the pinned bubble is upgraded to the context-bearing copy so the
    // CONTEXT.md chip renders in place instead of as a second message.
    const pinned = result.find((i) => i.id === "opt");
    expect(pinned?.type).toBe("user_message");
    if (pinned?.type !== "user_message")
      throw new Error("expected user_message");
    expect(pinned.content).toBe(echoedWithContext);
  });

  it("cloud: dedupe is no-op when there are no optimistic items", () => {
    const conversationItems = [
      userMessage("a", "first"),
      userMessage("b", "second"),
    ];
    const result = mergeConversationItems({
      conversationItems,
      optimisticItems: [],
      isCloud: true,
    });
    expect(result.map((i) => i.id)).toEqual(["a", "b"]);
    expect(result).toBe(conversationItems);
  });

  it("local: merge is no-op when there are no optimistic items", () => {
    const conversationItems = [
      userMessage("a", "first"),
      userMessage("b", "second"),
    ];
    const result = mergeConversationItems({
      conversationItems,
      optimisticItems: [],
      isCloud: false,
    });
    expect(result.map((i) => i.id)).toEqual(["a", "b"]);
    expect(result).toBe(conversationItems);
  });

  it("cloud: renders follow-up optimistic messages at the tail", () => {
    const result = mergeConversationItems({
      conversationItems: [userMessage("setup", "setup")],
      optimisticItems: [userMessage("opt", "follow up", false)],
      isCloud: true,
    });
    expect(result.map((i) => i.id)).toEqual(["setup", "opt"]);
  });

  it("cloud: does not dedupe historical messages against tail follow-up optimistics", () => {
    const result = mergeConversationItems({
      conversationItems: [
        userMessage("old", "repeat"),
        userMessage("setup", "setup"),
      ],
      optimisticItems: [userMessage("opt", "repeat", false)],
      isCloud: true,
    });
    expect(result.map((i) => i.id)).toEqual(["old", "setup", "opt"]);
  });
});
