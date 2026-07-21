import type { CloudTaskUpdatePayload, StoredLogEntry } from "@posthog/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudTaskQueuedMessage } from "./cloudTaskQueue";
import {
  type CloudTaskSession,
  CloudTaskSessionService,
  type CloudTaskSessionServicePorts,
  type CloudTaskWatcherHandle,
} from "./cloudTaskSessionService";

interface TestAttachment {
  name: string;
}

function session(overrides: Partial<CloudTaskSession> = {}): CloudTaskSession {
  return {
    taskRunId: "run-1",
    taskId: "task-1",
    events: [],
    status: "connected",
    isPromptPending: false,
    ...overrides,
  };
}

function logEntry(method: string, params?: unknown): StoredLogEntry {
  return {
    type: "notification",
    notification: { method, ...(params === undefined ? {} : { params }) },
  };
}

function createHarness(initialSessions: CloudTaskSession[] = [session()]): {
  service: CloudTaskSessionService<TestAttachment>;
  ports: CloudTaskSessionServicePorts<TestAttachment>;
  sessions: Map<string, CloudTaskSession>;
  queue: CloudTaskQueuedMessage<TestAttachment>[];
  watcher: CloudTaskWatcherHandle;
  update: (payload: CloudTaskUpdatePayload) => void;
} {
  const sessions = new Map(
    initialSessions.map((current) => [current.taskRunId, current]),
  );
  const queue: CloudTaskQueuedMessage<TestAttachment>[] = [];
  let onUpdate: (payload: CloudTaskUpdatePayload) => void = () => {};
  const watcher = {
    stop: vi.fn(),
    reconnectIfDisconnected: vi.fn(),
  };
  const ports: CloudTaskSessionServicePorts<TestAttachment> = {
    state: {
      getByTaskId: (taskId) =>
        [...sessions.values()].find((current) => current.taskId === taskId),
      getByRunId: (runId) => sessions.get(runId),
      set: (current) => sessions.set(current.taskRunId, current),
      update: (runId, updater) => {
        const current = sessions.get(runId);
        if (current) sessions.set(runId, updater(current));
      },
      remove: (runId) => {
        sessions.delete(runId);
      },
    },
    api: {
      getTask: vi.fn(async () => ({
        id: "task-1",
        latestRun: { id: "run-1", branch: "main" },
      })),
      runTask: vi.fn(async () => ({
        id: "task-1",
        latestRun: { id: "run-2" },
      })),
      sendCommand: vi.fn(async () => {}),
      cancelRun: vi.fn(async () => {}),
      classifyCommandError: vi.fn(() => ({ kind: "other" as const })),
    },
    watchers: {
      create: vi.fn((args) => {
        onUpdate = args.onUpdate;
        return watcher;
      }),
    },
    queue: {
      get: () => queue,
      drain: () => queue.splice(0, queue.length),
      prepend: (_taskId, messages) => queue.unshift(...messages),
      remove: (_taskId, messageId) => {
        const index = queue.findIndex((message) => message.id === messageId);
        if (index >= 0) queue.splice(index, 1);
      },
      combine: (messages) => ({
        text: messages.map((message) => message.content).join("\n"),
        attachments: messages.flatMap((message) => message.attachments),
      }),
    },
    prompts: {
      prepare: vi.fn(async (prompt) => ({ wirePayload: `wire:${prompt}` })),
    },
    time: {
      now: vi.fn(() => 1000),
      defer: vi.fn((callback) => callback()),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    effects: {
      onCompletion: vi.fn(),
      onNotification: vi.fn(),
    },
    preferences: {
      getComposerConfig: vi.fn(() => undefined),
      isRtkEnabled: vi.fn(() => true),
    },
  };
  return {
    service: new CloudTaskSessionService(ports),
    ports,
    sessions,
    queue,
    watcher,
    update: (payload) => onUpdate(payload),
  };
}

describe("CloudTaskSessionService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a missing run and starts its watcher", async () => {
    const harness = createHarness([]);

    await harness.service.connect({ id: "task-1", title: "Task" });

    expect(harness.ports.api.runTask).toHaveBeenCalledWith("task-1");
    expect(harness.sessions.get("run-2")).toMatchObject({
      taskId: "task-1",
      taskTitle: "Task",
      status: "connecting",
      isPromptPending: true,
      awaitingPing: true,
      promptStartedAt: 1000,
    });
    expect(harness.ports.watchers.create).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", runId: "run-2" }),
    );
  });

  it("sends a local echo and rolls it back when the command fails", async () => {
    const harness = createHarness();
    vi.mocked(harness.ports.api.sendCommand).mockRejectedValueOnce(
      new Error("offline"),
    );

    await expect(harness.service.sendPrompt("task-1", "hello")).rejects.toThrow(
      "offline",
    );

    expect(harness.sessions.get("run-1")).toMatchObject({
      events: [],
      isPromptPending: false,
    });
    expect(harness.ports.api.sendCommand).toHaveBeenCalledWith(
      "task-1",
      "run-1",
      "user_message",
      { content: "wire:hello" },
    );
  });

  it("resumes an inactive sandbox with the current composer configuration", async () => {
    const harness = createHarness([session({ status: "disconnected" })]);
    await harness.service.connect({
      id: "task-1",
      latestRun: { id: "run-1" },
    });
    vi.mocked(harness.ports.api.sendCommand).mockRejectedValueOnce(
      new Error("inactive"),
    );
    vi.mocked(harness.ports.api.classifyCommandError).mockReturnValueOnce({
      kind: "sandbox_inactive",
    });
    vi.mocked(harness.ports.preferences.getComposerConfig).mockReturnValueOnce({
      reasoning: "high",
      mode: "plan",
    });

    await harness.service.sendPrompt("task-1", "continue");

    expect(harness.ports.api.runTask).toHaveBeenCalledWith("task-1", {
      branch: "main",
      resumeFromRunId: "run-1",
      pendingUserMessage: "wire:continue",
      reasoningEffort: "high",
      initialPermissionMode: "plan",
      rtkEnabled: true,
    });
    expect(harness.watcher.stop).toHaveBeenCalledOnce();
    expect(harness.sessions.has("run-1")).toBe(false);
    expect(harness.sessions.get("run-2")).toMatchObject({
      taskRunId: "run-2",
      status: "connecting",
      isPromptPending: true,
      awaitingPing: true,
    });
  });

  it("routes permission responses by cloud request id and clears it", async () => {
    const harness = createHarness([
      session({
        cloudPermissionRequestIds: { "tool-1": "request-1" },
        pendingPermissions: {
          "tool-1": {
            requestId: "request-1",
            toolCall: { toolCallId: "tool-1", title: "Run", kind: "execute" },
            options: [],
          },
        },
      }),
    ]);

    await harness.service.sendPermissionResponse("task-1", {
      toolCallId: "tool-1",
      optionId: "allow",
      displayText: "Allowed",
    });

    expect(harness.ports.api.sendCommand).toHaveBeenCalledWith(
      "task-1",
      "run-1",
      "permission_response",
      {
        requestId: "request-1",
        optionId: "allow",
      },
    );
    expect(harness.sessions.get("run-1")?.cloudPermissionRequestIds).toEqual(
      {},
    );
  });

  it("dispatches configuration changes without mutating portable state", async () => {
    const currentSession = session();
    const harness = createHarness([currentSession]);

    await harness.service.setConfigOption("task-1", "model", "sonnet");

    expect(harness.ports.api.sendCommand).toHaveBeenCalledWith(
      "task-1",
      "run-1",
      "set_config_option",
      { configId: "model", value: "sonnet" },
    );
    expect(harness.sessions.get("run-1")).toEqual(currentSession);
  });

  it("retains prompt state when cancellation dispatch fails", async () => {
    const harness = createHarness([
      session({ isPromptPending: true, awaitingPing: true }),
    ]);
    vi.mocked(harness.ports.api.sendCommand).mockRejectedValueOnce(
      new Error("failed"),
    );

    await expect(harness.service.cancelPrompt("task-1")).resolves.toBe(false);

    expect(harness.sessions.get("run-1")).toMatchObject({
      isPromptPending: true,
      awaitingPing: true,
    });
    expect(harness.ports.logger.error).toHaveBeenCalledWith(
      "Failed to cancel cloud prompt",
      expect.any(Error),
    );
  });

  it("restores optimistic stop state when run cancellation fails", async () => {
    const harness = createHarness([session({ isPromptPending: true })]);
    vi.mocked(harness.ports.api.cancelRun).mockRejectedValueOnce(
      new Error("failed"),
    );

    await expect(harness.service.stopRun("task-1")).resolves.toBe(false);

    expect(harness.sessions.get("run-1")).toMatchObject({
      stopRequested: undefined,
      isPromptPending: true,
    });
  });

  it("dispatches stop requests to the active cloud run", async () => {
    const harness = createHarness([session({ isPromptPending: true })]);

    await expect(harness.service.stopRun("task-1")).resolves.toBe(true);

    expect(harness.ports.api.cancelRun).toHaveBeenCalledWith("task-1", "run-1");
  });

  it("restores drained messages when queue delivery fails", async () => {
    const harness = createHarness();
    harness.queue.push({
      id: "message-1",
      content: "queued",
      attachments: [],
      queuedAt: 1000,
    });
    vi.mocked(harness.ports.api.sendCommand).mockRejectedValueOnce(
      new Error("failed"),
    );

    await harness.service.flushQueuedMessages("task-1");

    expect(harness.queue.map((message) => message.id)).toEqual(["message-1"]);
  });

  it("tracks compaction and blocks steering until compaction ends", async () => {
    const harness = createHarness([session({ isPromptPending: true })]);
    harness.queue.push({
      id: "message-1",
      content: "queued",
      attachments: [],
      queuedAt: 1000,
    });

    harness.service.handleUpdate("run-1", {
      kind: "logs",
      taskId: "task-1",
      runId: "run-1",
      newEntries: [
        logEntry("_posthog/status", {
          status: "compacting",
          isComplete: false,
        }),
      ],
      totalEntryCount: 1,
    });
    await harness.service.steerQueuedMessage("task-1", "message-1");

    expect(harness.sessions.get("run-1")?.isCompacting).toBe(true);
    expect(harness.queue).toHaveLength(1);
    expect(harness.ports.api.sendCommand).not.toHaveBeenCalled();
  });

  it("notifies and flushes the queue when a live turn ends", () => {
    const harness = createHarness([
      session({
        isPromptPending: true,
        awaitingPing: true,
        promptStartedAt: 500,
      }),
    ]);
    harness.queue.push({
      id: "message-1",
      content: "next",
      attachments: [],
      queuedAt: 1000,
    });

    harness.service.handleUpdate("run-1", {
      kind: "logs",
      taskId: "task-1",
      runId: "run-1",
      newEntries: [logEntry("_posthog/turn_complete")],
      totalEntryCount: 1,
    });

    expect(harness.ports.effects.onCompletion).toHaveBeenCalledWith({
      taskId: "task-1",
      taskRunId: "run-1",
      promptStartedAt: 500,
    });
    expect(harness.ports.effects.onNotification).toHaveBeenCalledWith({
      taskId: "task-1",
      taskRunId: "run-1",
      kind: "turn_complete",
    });
    expect(harness.ports.time.defer).toHaveBeenCalledOnce();
  });

  it("records terminal failure and emits a status-only completion", () => {
    const harness = createHarness([
      session({ isPromptPending: true, awaitingPing: true }),
    ]);

    harness.service.handleUpdate("run-1", {
      kind: "status",
      taskId: "task-1",
      runId: "run-1",
      status: "failed",
      errorMessage: "boom",
    });

    expect(harness.sessions.get("run-1")).toMatchObject({
      terminalStatus: "failed",
      isPromptPending: false,
      awaitingPing: false,
      lastError: "boom",
    });
    expect(harness.ports.effects.onNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "task_failed" }),
    );
  });

  it("reconnects every active watcher and stops it on disconnect", async () => {
    const harness = createHarness([]);
    await harness.service.connect({
      id: "task-1",
      latestRun: { id: "run-1" },
    });

    harness.service.reconnectWatchers();
    harness.service.disconnect("task-1");

    expect(harness.watcher.reconnectIfDisconnected).toHaveBeenCalledOnce();
    expect(harness.watcher.stop).toHaveBeenCalledOnce();
    expect(harness.sessions.size).toBe(0);
  });
});
