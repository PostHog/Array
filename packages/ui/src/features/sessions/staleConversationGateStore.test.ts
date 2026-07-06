import { beforeEach, describe, expect, it } from "vitest";
import { useStaleConversationGateStore } from "./staleConversationGateStore";

const state = () => useStaleConversationGateStore.getState();
const acknowledged = (id: string) => state().acknowledgedSessions.has(id);
const engaged = (id: string) => state().engagedSessions.has(id);

describe("useStaleConversationGateStore", () => {
  beforeEach(() => {
    useStaleConversationGateStore.setState({
      engagedSessions: new Map(),
      acknowledgedSessions: new Set(),
    });
  });

  it("starts with nothing engaged or acknowledged", () => {
    expect(engaged("s1")).toBe(false);
    expect(acknowledged("s1")).toBe(false);
  });

  it("engages a single session with its last-activity snapshot", () => {
    state().engage("s1", 1000);
    expect(state().engagedSessions.get("s1")).toBe(1000);
    expect(engaged("s2")).toBe(false);
  });

  it("keeps the first engagement snapshot when engaged again", () => {
    state().engage("s1", 1000);
    state().engage("s1", 2000);
    expect(state().engagedSessions.get("s1")).toBe(1000);
  });

  it("does not re-engage an acknowledged session", () => {
    state().engage("s1", 1000);
    state().acknowledge("s1");
    state().engage("s1", 2000);
    expect(engaged("s1")).toBe(false);
  });

  it("acknowledges a single session and releases its engagement", () => {
    state().engage("s1", 1000);
    state().engage("s2", 1000);
    state().acknowledge("s1");
    expect(acknowledged("s1")).toBe(true);
    expect(engaged("s1")).toBe(false);
    expect(acknowledged("s2")).toBe(false);
    expect(engaged("s2")).toBe(true);
  });

  it("replaces the Set immutably on acknowledge", () => {
    const before = state().acknowledgedSessions;
    state().acknowledge("s1");
    const after = state().acknowledgedSessions;
    expect(after).not.toBe(before);
    expect(before.has("s1")).toBe(false);
  });

  it("is idempotent — acknowledging twice keeps the same reference", () => {
    state().acknowledge("s1");
    const first = state().acknowledgedSessions;
    state().acknowledge("s1");
    const second = state().acknowledgedSessions;
    expect(second).toBe(first);
  });

  it("acknowledging a never-engaged session keeps the engaged Map reference", () => {
    state().engage("s2", 1000);
    const before = state().engagedSessions;
    state().acknowledge("s1");
    expect(state().engagedSessions).toBe(before);
  });
});
