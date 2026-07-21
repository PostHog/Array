import type { AgentSession } from "@posthog/shared";
import type { Task, TaskRun } from "@posthog/shared/domain-types";
import { describe, expect, it, vi } from "vitest";
import { SessionService, type SessionServiceDeps } from "./sessionService";

const sourceSession = {
  taskRunId: "source-run",
  taskId: "source-task",
  taskTitle: "Source task",
  channel: "source-channel",
  events: [],
  startedAt: 1,
  status: "connected",
  isPromptPending: false,
  isCompacting: false,
  promptStartedAt: null,
  pendingPermissions: new Map(),
  pausedDurationMs: 0,
  messageQueue: [],
  optimisticItems: [],
  executionMode: "acceptEdits",
  adapter: "claude",
  model: "claude-sonnet-4-5",
  reasoningLevel: "medium",
} as AgentSession;

const childRun = {
  id: "child-run",
  task: "child-task",
  team: 1,
  branch: "main",
  environment: "local",
  status: "in_progress",
  log_url: "https://example.com/logs/child-run",
  error_message: null,
  output: null,
  state: { existing: true },
  created_at: "2026-07-21T00:00:00Z",
  updated_at: "2026-07-21T00:00:00Z",
  completed_at: null,
} as TaskRun;

const childTask = {
  id: "child-task",
  task_number: 2,
  slug: "child-task",
  title: "Child task",
  description: "Fork the task",
  origin_product: "user_created",
  repository: "PostHog/code",
  created_at: "2026-07-21T00:00:00Z",
  updated_at: "2026-07-21T00:00:00Z",
  latest_run: undefined,
} as Task;

function createHarness(updateTaskRun: ReturnType<typeof vi.fn>) {
  const setSession = vi.fn();
  const setPersistedConfigOptions = vi.fn();
  const setAdapter = vi.fn();
  const subscribe = vi.fn(() => ({ unsubscribe: vi.fn() }));
  const track = vi.fn();
  const flushLogs = vi.fn().mockResolvedValue(undefined);
  const cloneLocalLogs = vi.fn().mockResolvedValue(undefined);
  const fork = vi.fn().mockResolvedValue({
    channel: "child-channel",
    configOptions: [{ id: "model", type: "select" }],
  });
  const deps = {
    store: {
      getSessionByTaskId: vi.fn(() => sourceSession),
      setSession,
    },
    trpc: {
      agent: {
        flushLogs: { mutate: flushLogs },
        fork: { mutate: fork },
        onSessionEvent: { subscribe },
        onPermissionRequest: { subscribe },
        onSessionIdleKilled: { subscribe },
      },
      logs: {
        cloneLocalLogs: { mutate: cloneLocalLogs },
      },
    },
    fetchAuthState: vi.fn().mockResolvedValue({
      status: "authenticated",
      bootstrapComplete: true,
      cloudRegion: "us",
      currentProjectId: 1,
    }),
    createAuthenticatedClient: vi.fn(() => ({
      createTaskRun: vi.fn().mockResolvedValue(childRun),
      updateTaskRun,
    })),
    settings: {},
    setPersistedConfigOptions,
    adapterStore: { setAdapter },
    DEFAULT_GATEWAY_MODEL: "claude-sonnet-4-5",
    track,
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as SessionServiceDeps;

  return {
    service: new SessionService(deps),
    setSession,
    setPersistedConfigOptions,
    setAdapter,
    subscribe,
    track,
    flushLogs,
    cloneLocalLogs,
    fork,
  };
}

describe("SessionService.forkLocalTask", () => {
  it("persists lineage before publishing the child session", async () => {
    const updateTaskRun = vi.fn().mockResolvedValue({
      ...childRun,
      state: {
        ...childRun.state,
        forked_from_task_id: "source-task",
        forked_from_run_id: "source-run",
      },
    });
    const {
      service,
      setSession,
      setPersistedConfigOptions,
      setAdapter,
      flushLogs,
      cloneLocalLogs,
      fork,
    } = createHarness(updateTaskRun);

    await service.forkLocalTask({
      sourceTaskId: "source-task",
      task: { ...childTask },
      repoPath: "/repos/code",
    });

    expect(updateTaskRun).toHaveBeenCalledWith("child-task", "child-run", {
      state: {
        existing: true,
        forked_from_task_id: "source-task",
        forked_from_run_id: "source-run",
      },
    });
    expect(flushLogs).toHaveBeenCalledWith({ taskRunId: "source-run" });
    expect(cloneLocalLogs).toHaveBeenCalledWith({
      sourceTaskRunId: "source-run",
      targetTaskRunId: "child-run",
    });
    expect(flushLogs.mock.invocationCallOrder[0]).toBeLessThan(
      cloneLocalLogs.mock.invocationCallOrder[0],
    );
    expect(cloneLocalLogs.mock.invocationCallOrder[0]).toBeLessThan(
      updateTaskRun.mock.invocationCallOrder[0],
    );
    expect(updateTaskRun.mock.invocationCallOrder[0]).toBeLessThan(
      fork.mock.invocationCallOrder[0],
    );
    expect(updateTaskRun.mock.invocationCallOrder[0]).toBeLessThan(
      setPersistedConfigOptions.mock.invocationCallOrder[0],
    );
    expect(updateTaskRun.mock.invocationCallOrder[0]).toBeLessThan(
      setAdapter.mock.invocationCallOrder[0],
    );
    expect(updateTaskRun.mock.invocationCallOrder[0]).toBeLessThan(
      setSession.mock.invocationCallOrder[0],
    );
  });

  it("does not publish or persist a child session when lineage fails", async () => {
    const updateTaskRun = vi
      .fn()
      .mockRejectedValue(new Error("lineage failed"));
    const {
      service,
      setSession,
      setPersistedConfigOptions,
      setAdapter,
      subscribe,
      track,
      fork,
    } = createHarness(updateTaskRun);

    await expect(
      service.forkLocalTask({
        sourceTaskId: "source-task",
        task: { ...childTask },
        repoPath: "/repos/code",
      }),
    ).rejects.toThrow("lineage failed");

    expect(setPersistedConfigOptions).not.toHaveBeenCalled();
    expect(setAdapter).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
    expect(fork).not.toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
  });
});
