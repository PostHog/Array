import type { AgentSession } from "@posthog/shared";
import { describe, expect, it, vi } from "vitest";
import { SessionService, type SessionServiceDeps } from "./sessionService";

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    taskRunId: "run-1",
    taskId: "task-1",
    taskTitle: "Test task",
    channel: "",
    events: [],
    startedAt: 1,
    status: "connected",
    isCloud: true,
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

/**
 * The adapter carried through executeHandoff decides which runtime the saga
 * spawns locally. A cloud-NATIVE task never populates the persisted adapterStore
 * (no local SDK_SESSION/reconnect ever ran), so the handoff must fall back to the
 * renderer session.adapter (set from runtime_adapter). Without the fallback a
 * codex cloud-native run reconnects as Claude and 401s the first post-handoff turn.
 */
function createHarness(
  session: AgentSession,
  storedAdapter?: "claude" | "codex",
) {
  const execute = vi.fn().mockResolvedValue({ success: true });
  const sessions: Record<string, AgentSession> = {
    [session.taskRunId]: session,
  };
  const store = {
    getSessionByTaskId: (taskId: string) =>
      Object.values(sessions).find((s) => s.taskId === taskId),
    getSessions: () => sessions,
    updateSession: vi.fn(),
  };
  const noopSub = { unsubscribe: vi.fn() };
  const deps = {
    store,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    toast: { error: vi.fn(), success: vi.fn() },
    fetchAuthState: vi
      .fn()
      .mockResolvedValue({ currentProjectId: 3, cloudRegion: "us" }),
    getPersistedConfigOptions: () => undefined,
    setPersistedConfigOptions: vi.fn(),
    adapterStore: {
      getAdapter: () => storedAdapter,
      setAdapter: vi.fn(),
      removeAdapter: vi.fn(),
    },
    queryClient: { refetchQueries: vi.fn().mockResolvedValue(undefined) },
    WORKSPACE_QUERY_KEY: ["workspace"],
    trpc: {
      handoff: {
        preflight: {
          query: vi
            .fn()
            .mockResolvedValue({ canHandoff: true, localGitState: undefined }),
        },
        execute: { mutate: execute },
      },
      agent: {
        onSessionEvent: { subscribe: () => noopSub },
        onPermissionRequest: { subscribe: () => noopSub },
      },
      checkpoint: {
        replayCheckpoints: { mutate: vi.fn().mockResolvedValue({ count: 0 }) },
      },
      workspace: {
        verify: { query: vi.fn().mockResolvedValue({ exists: true }) },
      },
    },
  } as unknown as SessionServiceDeps;

  const service = new SessionService(deps);
  return { service, execute };
}

describe("executeHandoff adapter resolution", () => {
  it("falls back to session.adapter for a cloud-native task (empty adapterStore)", async () => {
    const { service, execute } = createHarness(
      makeSession({ adapter: "codex" }),
      undefined,
    );

    await service.handoffToLocal("task-1", "/repo");

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ adapter: "codex" });
  });

  it("prefers the authoritative adapterStore over a stale session.adapter", async () => {
    // Task handed off FROM local: its renderer session.adapter can be a stale
    // "claude", but the persisted store holds the real runtime.
    const { service, execute } = createHarness(
      makeSession({ isCloud: false, adapter: "claude" }),
      "codex",
    );

    await service.handoffToLocal("task-1", "/repo");

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ adapter: "codex" });
  });
});
