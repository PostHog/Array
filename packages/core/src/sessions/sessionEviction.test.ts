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
    ["disconnected local session", { status: "disconnected" as const }, true],
    ["errored local session", { status: "error" as const }, true],
  ])("%s -> %s", (_name, overrides, expected) => {
    expect(isSessionIdle(makeSession({ taskId: "t", ...overrides }))).toBe(
      expected,
    );
  });
});

describe("selectSessionsToEvict", () => {
  const lastUsedAt = (session: AgentSession) => session.startedAt;

  it.each([
    [
      "returns nothing under the budget",
      {
        sessions: [makeSession({ taskId: "a" }), makeSession({ taskId: "b" })],
        activeTaskId: "a",
        maxSessions: 3,
      },
      [],
    ],
    [
      "evicts the least recently used idle sessions over the budget",
      {
        sessions: [
          makeSession({ taskId: "a", startedAt: 30 }),
          makeSession({ taskId: "b", startedAt: 10 }),
          makeSession({ taskId: "c", startedAt: 20 }),
          makeSession({ taskId: "d", startedAt: 40 }),
        ],
        activeTaskId: "d",
        maxSessions: 3,
      },
      ["b", "c"],
    ],
    [
      "never evicts the active task or busy sessions",
      {
        sessions: [
          makeSession({ taskId: "active", startedAt: 1 }),
          makeSession({ taskId: "busy", startedAt: 2, isPromptPending: true }),
          makeSession({ taskId: "idle", startedAt: 3 }),
        ],
        activeTaskId: "active",
        maxSessions: 2,
      },
      ["idle"],
    ],
    [
      "never evicts mounted tasks",
      {
        sessions: [
          makeSession({ taskId: "a", startedAt: 1 }),
          makeSession({ taskId: "b", startedAt: 2 }),
          makeSession({ taskId: "c", startedAt: 3 }),
        ],
        activeTaskId: "c",
        protectedTaskIds: new Set(["a"]),
        maxSessions: 2,
      },
      ["b"],
    ],
  ])("%s", (_name, params, expected) => {
    const evicted = selectSessionsToEvict({ ...params, lastUsedAt });
    expect(evicted.map((s) => s.taskId)).toEqual(expected);
  });
});
