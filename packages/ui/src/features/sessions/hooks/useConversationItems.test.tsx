import type { AcpMessage } from "@posthog/shared";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useConversationItems } from "./useConversationItems";

function userPromptMsg(ts: number, id: number, text: string): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      id,
      method: "session/prompt",
      params: { prompt: [{ type: "text", text }] },
    },
  };
}

function promptResponseMsg(ts: number, id: number): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: { jsonrpc: "2.0", id, result: { stopReason: "end_turn" } },
  };
}

function transcript(): AcpMessage[] {
  return [
    userPromptMsg(1, 1, "first prompt"),
    promptResponseMsg(2, 1),
    userPromptMsg(3, 2, "second prompt"),
  ];
}

describe("useConversationItems persistence", () => {
  it("returns the identical result after a remount with a persist key", () => {
    const events = transcript();
    const key = { scope: "test-hook", taskId: "idle-remount" };

    const first = renderHook(() =>
      useConversationItems(events, false, undefined, key),
    );
    const firstResult = first.result.current;
    first.unmount();

    const second = renderHook(() =>
      useConversationItems(events, false, undefined, key),
    );
    expect(second.result.current).toBe(firstResult);
  });

  it("reuses completed turn items across a remount while streaming", () => {
    const events = transcript();
    const key = { scope: "test-hook", taskId: "streaming-remount" };

    const first = renderHook(() =>
      useConversationItems(events, true, undefined, key),
    );
    const firstItems = first.result.current.items;
    first.unmount();

    // Streaming appends preserve element identity (immer structural sharing);
    // a surviving builder must take the append fast path, not rebuild.
    const appended = [...events, promptResponseMsg(4, 2)];
    const second = renderHook(() =>
      useConversationItems(appended, true, undefined, key),
    );
    expect(second.result.current.items[0]).toBe(firstItems[0]);
  });

  it("rebuilds from scratch on remount without a persist key", () => {
    const events = transcript();

    const first = renderHook(() => useConversationItems(events, false));
    const firstItems = first.result.current.items;
    first.unmount();

    const second = renderHook(() => useConversationItems(events, false));
    expect(second.result.current.items[0]).not.toBe(firstItems[0]);
  });
});
