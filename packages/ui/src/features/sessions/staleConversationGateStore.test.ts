import { beforeEach, describe, expect, it } from "vitest";
import { useStaleConversationGateStore } from "./staleConversationGateStore";

const acknowledged = (id: string) =>
  useStaleConversationGateStore.getState().acknowledgedSessions.has(id);

describe("useStaleConversationGateStore", () => {
  beforeEach(() => {
    useStaleConversationGateStore.setState({ acknowledgedSessions: new Set() });
  });

  it("starts with nothing acknowledged", () => {
    expect(acknowledged("s1")).toBe(false);
  });

  it("acknowledges a single session without affecting others", () => {
    useStaleConversationGateStore.getState().acknowledge("s1");
    expect(acknowledged("s1")).toBe(true);
    expect(acknowledged("s2")).toBe(false);
  });

  it("replaces the Set immutably on acknowledge", () => {
    const before =
      useStaleConversationGateStore.getState().acknowledgedSessions;
    useStaleConversationGateStore.getState().acknowledge("s1");
    const after = useStaleConversationGateStore.getState().acknowledgedSessions;
    expect(after).not.toBe(before);
    expect(before.has("s1")).toBe(false);
  });

  it("is idempotent — acknowledging twice keeps the same reference", () => {
    useStaleConversationGateStore.getState().acknowledge("s1");
    const first = useStaleConversationGateStore.getState().acknowledgedSessions;
    useStaleConversationGateStore.getState().acknowledge("s1");
    const second =
      useStaleConversationGateStore.getState().acknowledgedSessions;
    expect(second).toBe(first);
  });
});
