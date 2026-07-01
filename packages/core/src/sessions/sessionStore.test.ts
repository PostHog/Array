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
});
