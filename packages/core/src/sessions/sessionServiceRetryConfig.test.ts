import type { AgentSession } from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import { describe, expect, it, vi } from "vitest";
import {
  type ConnectParams,
  SessionService,
  type SessionServiceDeps,
} from "./sessionService";

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    taskRunId: "run-1",
    taskId: "task-1",
    taskTitle: "Test task",
    channel: "",
    events: [],
    startedAt: 1,
    status: "error",
    isPromptPending: false,
    isCompacting: false,
    promptStartedAt: null,
    pendingPermissions: new Map(),
    pausedDurationMs: 0,
    messageQueue: [],
    optimisticItems: [],
    initialPrompt: [{ type: "text", text: "Ship the fix" }],
    ...overrides,
  } as AgentSession;
}

function createHarness(session: AgentSession) {
  const sessions: Record<string, AgentSession> = {
    [session.taskRunId]: session,
  };
  const deps = {
    store: {
      getSessionByTaskId: (taskId: string) =>
        Object.values(sessions).find((s) => s.taskId === taskId),
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    trpc: {
      agent: {
        onSessionIdleKilled: {
          subscribe: () => ({ unsubscribe: vi.fn() }),
        },
      },
    },
  } as unknown as SessionServiceDeps;

  const service = new SessionService(deps);
  vi.spyOn(
    service as unknown as { teardownSession: () => Promise<void> },
    "teardownSession",
  ).mockResolvedValue(undefined);
  vi.spyOn(
    service as unknown as {
      getAuthCredentialsStatus: () => Promise<unknown>;
    },
    "getAuthCredentialsStatus",
  ).mockResolvedValue({ kind: "ready", auth: { client: {} } });
  const createNewLocalSession = vi
    .spyOn(
      service as unknown as {
        createNewLocalSession: (...args: unknown[]) => Promise<void>;
      },
      "createNewLocalSession",
    )
    .mockResolvedValue(undefined);

  return { service, createNewLocalSession };
}

describe("SessionService.clearSessionError retry config", () => {
  it("recreates the session with the original run configuration", async () => {
    const session = makeSession({
      model: "claude-fable-5",
      adapter: "claude",
      executionMode: "auto",
      reasoningLevel: "high",
    });
    const { service, createNewLocalSession } = createHarness(session);

    await service.clearSessionError("task-1", "/repo");

    expect(createNewLocalSession).toHaveBeenCalledWith(
      "task-1",
      "Test task",
      "/repo",
      { client: {} },
      session.initialPrompt,
      "auto", // executionMode
      "claude", // adapter
      "claude-fable-5", // model
      "high", // reasoningLevel
    );
  });
});

const CONNECT_PARAMS: ConnectParams = {
  task: {
    id: "task-1",
    title: "Test task",
    description: "Ship the fix",
    latest_run: null,
  } as unknown as Task,
  repoPath: "/repo",
  initialPrompt: [{ type: "text", text: "Ship the fix" }],
  executionMode: "auto",
  adapter: "claude",
  model: "claude-fable-5",
  reasoningLevel: "high",
};

function assertRunConfigPersisted(setSession: ReturnType<typeof vi.fn>): void {
  // Exactly one error session should be stored — pinning this stops a future
  // setup change (e.g. one that lets the auto-retry loop run) from slipping an
  // intermediate session past the last-call assertions below.
  expect(setSession.mock.calls.length).toBe(1);
  const stored = setSession.mock.calls.at(-1)?.[0] as AgentSession;
  expect(stored.status).toBe("error");
  expect(stored.model).toBe("claude-fable-5");
  expect(stored.adapter).toBe("claude");
  expect(stored.executionMode).toBe("auto");
  expect(stored.reasoningLevel).toBe("high");
  expect(stored.initialPrompt).toEqual([
    { type: "text", text: "Ship the fix" },
  ]);
}

describe("SessionService.connectToTask start failure", () => {
  it("persists the run configuration on the error session so retry keeps the model", async () => {
    const setSession = vi.fn();
    const deps = {
      store: {
        getSessionByTaskId: () => undefined,
        getSessions: () => ({}),
        setSession,
      },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      settings: { customInstructions: "" },
      DEFAULT_GATEWAY_MODEL: "claude-opus-4-8",
      // Online for the create-branch check, offline in the catch so the
      // auto-retry loop is skipped and the stored error session is asserted.
      getIsOnline: vi
        .fn<() => boolean>()
        .mockReturnValueOnce(true)
        .mockReturnValue(false),
      trpc: {
        agent: {
          start: {
            mutate: vi
              .fn()
              .mockRejectedValue(new Error("session start timeout")),
          },
          onSessionIdleKilled: {
            subscribe: () => ({ unsubscribe: vi.fn() }),
          },
        },
      },
    } as unknown as SessionServiceDeps;

    const service = new SessionService(deps);
    vi.spyOn(
      service as unknown as {
        getAuthCredentialsStatus: () => Promise<unknown>;
      },
      "getAuthCredentialsStatus",
    ).mockResolvedValue({
      kind: "ready",
      auth: {
        client: { createTaskRun: vi.fn().mockResolvedValue({ id: "run-1" }) },
        apiHost: "https://app",
        projectId: 1,
      },
    });

    await service.connectToTask(CONNECT_PARAMS);

    assertRunConfigPersisted(setSession);
  });
});

describe("SessionService.connectToTask missing auth", () => {
  it("persists the run configuration on the auth-required error session", async () => {
    const setSession = vi.fn();
    const deps = {
      store: {
        getSessionByTaskId: () => undefined,
        getSessions: () => ({}),
        setSession,
      },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getIsOnline: () => true,
      trpc: {
        agent: {
          onSessionIdleKilled: {
            subscribe: () => ({ unsubscribe: vi.fn() }),
          },
        },
      },
    } as unknown as SessionServiceDeps;

    const service = new SessionService(deps);
    // No credentials → the no-auth branch stores an error session and returns
    // before ever starting a run.
    vi.spyOn(
      service as unknown as {
        getAuthCredentialsStatus: () => Promise<unknown>;
      },
      "getAuthCredentialsStatus",
    ).mockResolvedValue({ kind: "missing" });

    await service.connectToTask(CONNECT_PARAMS);

    assertRunConfigPersisted(setSession);
  });
});
