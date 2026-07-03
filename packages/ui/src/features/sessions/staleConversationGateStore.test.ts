import { beforeEach, describe, expect, it } from "vitest";
import { useStaleConversationGateStore } from "./staleConversationGateStore";

describe("useStaleConversationGateStore", () => {
  beforeEach(() => {
    useStaleConversationGateStore.setState({ acknowledgedSessions: new Set() });
  });

  it("starts with nothing acknowledged", () => {
    expect(useStaleConversationGateStore.getState().isAcknowledged("s1")).toBe(
      false,
    );
  });

  it("acknowledges a single session without affecting others", () => {
    useStaleConversationGateStore.getState().acknowledge("s1");
    const state = useStaleConversationGateStore.getState();
    expect(state.isAcknowledged("s1")).toBe(true);
    expect(state.isAcknowledged("s2")).toBe(false);
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

  it("reset clears a single session's acknowledgement", () => {
    const { acknowledge, reset } = useStaleConversationGateStore.getState();
    acknowledge("s1");
    reset("s1");
    expect(useStaleConversationGateStore.getState().isAcknowledged("s1")).toBe(
      false,
    );
  });
});
