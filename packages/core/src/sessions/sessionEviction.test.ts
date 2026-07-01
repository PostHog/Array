import type { AgentSession } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import { isSessionIdle, selectSessionsToEvict } from "./sessionEviction";

function makeSession(overrides: Partial<AgentSession>): AgentSession {
  return {
    taskRunId: `run-${overrides.taskId}`,
    status: "connected",
    isPromptPending: false,
    pendingPermissions: new Map(),
    messageQueue: [],
    startedAt: 0,
    ...overrides,
  } as AgentSession;
}

describe("isSessionIdle", () => {
  it.each([
    ["connected idle local session", {}, true],
    ["connecting session", { status: "connecting" as const }, false],
    ["pending prompt", { isPromptPending: true }, false],
    [
      "pending permission",
      { pendingPermissions: new Map([["p1", {} as never]]) },
      false,
    ],
    [
      "queued messages",
      { messageQueue: [{ id: "m1", content: "x", queuedAt: 0 }] },
      false,
    ],
    [
      "running cloud session",
      { isCloud: true, cloudStatus: "in_progress" as const },
      false,
    ],
    [
      "queued cloud session",
      { isCloud: true, cloudStatus: "queued" as const },
      false,
    ],
    [
      "completed cloud session",
      { isCloud: true, cloudStatus: "completed" as const },
      true,
    ],
    ["cloud session without status", { isCloud: true }, false],
  ])("%s -> %s", (_name, overrides, expected) => {
    expect(isSessionIdle(makeSession({ taskId: "t", ...overrides }))).toBe(
      expected,
    );
  });
});

describe("selectSessionsToEvict", () => {
  const lastUsedAt = (session: AgentSession) => session.startedAt;

  it("returns nothing under the budget", () => {
    const sessions = [
      makeSession({ taskId: "a" }),
      makeSession({ taskId: "b" }),
    ];
    expect(
      selectSessionsToEvict({
        sessions,
        activeTaskId: "a",
        lastUsedAt,
        maxSessions: 3,
      }),
    ).toEqual([]);
  });

  it("evicts the least recently used idle sessions over the budget", () => {
    const sessions = [
      makeSession({ taskId: "a", startedAt: 30 }),
      makeSession({ taskId: "b", startedAt: 10 }),
      makeSession({ taskId: "c", startedAt: 20 }),
      makeSession({ taskId: "d", startedAt: 40 }),
    ];
    const evicted = selectSessionsToEvict({
      sessions,
      activeTaskId: "d",
      lastUsedAt,
      maxSessions: 3,
    });
    expect(evicted.map((s) => s.taskId)).toEqual(["b", "c"]);
  });

  it("never evicts the active task or busy sessions", () => {
    const sessions = [
      makeSession({ taskId: "active", startedAt: 1 }),
      makeSession({ taskId: "busy", startedAt: 2, isPromptPending: true }),
      makeSession({ taskId: "idle", startedAt: 3 }),
    ];
    const evicted = selectSessionsToEvict({
      sessions,
      activeTaskId: "active",
      lastUsedAt,
      maxSessions: 2,
    });
    expect(evicted.map((s) => s.taskId)).toEqual(["idle"]);
  });
});
