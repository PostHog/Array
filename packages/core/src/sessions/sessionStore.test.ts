import type { AcpMessage, AgentSession } from "@posthog/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_SESSION_EVENTS,
  sessionStore,
  sessionStoreSetters,
} from "./sessionStore";

function event(n: number): AcpMessage {
  return {
    type: "acp_message",
    ts: n,
    message: {
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionUpdate: "agent_message_chunk", n },
    },
  } as AcpMessage;
}

function makeSession(taskRunId: string, taskId: string): AgentSession {
  return {
    taskRunId,
    taskId,
    events: [],
    optimisticItems: [],
    messageQueue: [],
    pendingPermissions: new Map(),
  } as unknown as AgentSession;
}

function events(count: number, offset = 0): AcpMessage[] {
  return Array.from({ length: count }, (_, i) => event(offset + i));
}

describe("sessionStore event cap", () => {
  beforeEach(() => {
    sessionStoreSetters.clearAll();
    sessionStoreSetters.setSession(makeSession("run-1", "task-1"));
  });

  it("keeps events unbounded-free: appends under the cap verbatim", () => {
    sessionStoreSetters.appendEvents("run-1", events(10));

    const session = sessionStore.getState().sessions["run-1"];
    expect(session.events).toHaveLength(10);
    expect(session.trimmedEventCount ?? 0).toBe(0);
  });

  it("drops the oldest events beyond MAX_SESSION_EVENTS and records the trim", () => {
    sessionStoreSetters.appendEvents("run-1", events(MAX_SESSION_EVENTS + 100));

    const session = sessionStore.getState().sessions["run-1"];
    expect(session.events).toHaveLength(MAX_SESSION_EVENTS);
    expect(session.trimmedEventCount).toBe(100);
    expect(
      (session.events[0].message as { params: { n: number } }).params.n,
    ).toBe(100);
  });

  it("accumulates trimmedEventCount across appends", () => {
    sessionStoreSetters.appendEvents("run-1", events(MAX_SESSION_EVENTS));
    sessionStoreSetters.appendEvents("run-1", events(50, MAX_SESSION_EVENTS));
    sessionStoreSetters.appendEvents(
      "run-1",
      events(25, MAX_SESSION_EVENTS + 50),
    );

    const session = sessionStore.getState().sessions["run-1"];
    expect(session.events).toHaveLength(MAX_SESSION_EVENTS);
    expect(session.trimmedEventCount).toBe(75);
    expect(
      (session.events.at(-1)?.message as { params: { n: number } }).params.n,
    ).toBe(MAX_SESSION_EVENTS + 74);
  });

  it("trims in replaceOptimisticWithEvent too", () => {
    sessionStoreSetters.appendEvents("run-1", events(MAX_SESSION_EVENTS));
    sessionStoreSetters.appendOptimisticItem("run-1", {
      type: "user_message",
      content: "hi",
    } as never);

    sessionStoreSetters.replaceOptimisticWithEvent(
      "run-1",
      event(MAX_SESSION_EVENTS),
    );

    const session = sessionStore.getState().sessions["run-1"];
    expect(session.events).toHaveLength(MAX_SESSION_EVENTS);
    expect(session.trimmedEventCount).toBe(1);
    expect(session.optimisticItems).toHaveLength(0);
  });

  it("trims oversized histories installed via setSession", () => {
    const hydrated = makeSession("run-2", "task-2");
    hydrated.events = events(MAX_SESSION_EVENTS + 200);
    sessionStoreSetters.setSession(hydrated);

    const session = sessionStore.getState().sessions["run-2"];
    expect(session.events).toHaveLength(MAX_SESSION_EVENTS);
    expect(session.trimmedEventCount).toBe(200);
  });

  it("trims oversized histories installed via updateSession", () => {
    sessionStoreSetters.updateSession("run-1", {
      events: events(MAX_SESSION_EVENTS + 30),
    });

    const session = sessionStore.getState().sessions["run-1"];
    expect(session.events).toHaveLength(MAX_SESSION_EVENTS);
    expect(session.trimmedEventCount).toBe(30);
  });

  it("leaves untouched events alone in updateSession without events", () => {
    sessionStoreSetters.appendEvents("run-1", events(10));
    sessionStoreSetters.updateSession("run-1", { taskTitle: "renamed" });

    const session = sessionStore.getState().sessions["run-1"];
    expect(session.events).toHaveLength(10);
    expect(session.trimmedEventCount ?? 0).toBe(0);
  });

  it("resets the trim offset when updateSession replaces the stream", () => {
    sessionStoreSetters.appendEvents("run-1", events(MAX_SESSION_EVENTS + 40));
    expect(sessionStore.getState().sessions["run-1"].trimmedEventCount).toBe(
      40,
    );

    sessionStoreSetters.updateSession("run-1", { events: events(10) });

    const session = sessionStore.getState().sessions["run-1"];
    expect(session.events).toHaveLength(10);
    expect(session.trimmedEventCount).toBe(0);
  });

  it("caps rehydrated histories in restoreEvents and restarts the offset", () => {
    sessionStoreSetters.appendEvents("run-1", events(MAX_SESSION_EVENTS + 40));

    sessionStoreSetters.restoreEvents(
      "run-1",
      events(MAX_SESSION_EVENTS + 7),
      MAX_SESSION_EVENTS + 7,
    );

    const session = sessionStore.getState().sessions["run-1"];
    expect(session.events).toHaveLength(MAX_SESSION_EVENTS);
    expect(session.trimmedEventCount).toBe(7);
  });

  it("clears the trim offset when a transcript is evicted", () => {
    sessionStoreSetters.appendEvents("run-1", events(MAX_SESSION_EVENTS + 5));

    sessionStoreSetters.evictEvents("run-1");

    const session = sessionStore.getState().sessions["run-1"];
    expect(session.events).toHaveLength(0);
    expect(session.trimmedEventCount).toBe(0);
  });
});
