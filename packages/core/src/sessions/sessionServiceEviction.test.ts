import type { AgentSession } from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import { describe, expect, it, vi } from "vitest";
import { MAX_CONNECTED_SESSIONS } from "./sessionEviction";
import { SessionService, type SessionServiceDeps } from "./sessionService";

function makeSession(
  taskId: string,
  startedAt: number,
  overrides: Partial<AgentSession> = {},
): AgentSession {
  return {
    taskRunId: `run-${taskId}`,
    taskId,
    taskTitle: taskId,
    channel: "",
    events: [],
    startedAt,
    status: "connected",
    isPromptPending: false,
    isCompacting: false,
    promptStartedAt: null,
    pendingPermissions: new Map(),
    pausedDurationMs: 0,
    messageQueue: [],
    optimisticItems: [],
    ...overrides,
  } as AgentSession;
}

function createHarness(seedSessions: AgentSession[]) {
  const sessions: Record<string, AgentSession> = {};
  for (const session of seedSessions) {
    sessions[session.taskRunId] = session;
  }
  const removeSession = vi.fn((taskRunId: string) => {
    delete sessions[taskRunId];
  });
  const cancelMutate = vi.fn().mockResolvedValue(undefined);

  const store = {
    getSessions: () => sessions,
    getSessionByTaskId: (taskId: string) =>
      Object.values(sessions).find((s) => s.taskId === taskId),
    removeSession,
  };

  const noopLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const deps = {
    store,
    log: noopLog,
    getPersistedConfigOptions: () => undefined,
    setPersistedConfigOptions: vi.fn(),
    removePersistedConfigOptions: vi.fn(),
    adapterStore: {
      getAdapter: () => undefined,
      setAdapter: vi.fn(),
      removeAdapter: vi.fn(),
    },
    trpc: {
      agent: {
        cancel: { mutate: cancelMutate },
        onSessionIdleKilled: {
          subscribe: () => ({ unsubscribe: vi.fn() }),
        },
      },
    },
  } as unknown as SessionServiceDeps;

  const service = new SessionService(deps);
  return { service, sessions, removeSession, cancelMutate };
}

function connectParamsFor(taskId: string) {
  return {
    task: { id: taskId, title: taskId, description: taskId } as Task,
    repoPath: "/repo",
  };
}

describe("SessionService idle session eviction", () => {
  it("evicts the least recently used idle sessions beyond the budget", async () => {
    const idleCount = MAX_CONNECTED_SESSIONS;
    const seeds = Array.from({ length: idleCount }, (_, i) =>
      makeSession(`idle-${i}`, i + 1),
    );
    seeds.push(makeSession("active", 1000));
    const { service, removeSession } = createHarness(seeds);

    await service.connectToTask(connectParamsFor("active"));

    await vi.waitFor(() => {
      expect(removeSession).toHaveBeenCalledTimes(2);
    });
    expect(removeSession).toHaveBeenCalledWith("run-idle-0");
    expect(removeSession).toHaveBeenCalledWith("run-idle-1");
  });

  it("never evicts mounted or busy sessions", async () => {
    const idleCount = MAX_CONNECTED_SESSIONS;
    const seeds = Array.from({ length: idleCount }, (_, i) =>
      makeSession(`idle-${i}`, i + 1, {
        isPromptPending: i === 1,
      }),
    );
    seeds.push(makeSession("active", 1000));
    const { service, removeSession } = createHarness(seeds);

    const unregister = service.registerMountedTask("idle-0");

    await service.connectToTask(connectParamsFor("active"));

    await vi.waitFor(() => {
      expect(removeSession).toHaveBeenCalledTimes(2);
    });
    expect(removeSession).not.toHaveBeenCalledWith("run-idle-0");
    expect(removeSession).not.toHaveBeenCalledWith("run-idle-1");
    expect(removeSession).toHaveBeenCalledWith("run-idle-2");
    expect(removeSession).toHaveBeenCalledWith("run-idle-3");
    unregister();
  });

  it("evicts nothing at or under the budget", async () => {
    const seeds = Array.from({ length: MAX_CONNECTED_SESSIONS - 2 }, (_, i) =>
      makeSession(`idle-${i}`, i + 1),
    );
    seeds.push(makeSession("active", 1000));
    const { service, removeSession } = createHarness(seeds);

    await service.connectToTask(connectParamsFor("active"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removeSession).not.toHaveBeenCalled();
  });
});
