import type { AgentSession, StoredLogEntry } from "@posthog/shared";
import type { CloudTaskUpdatePayload } from "@posthog/shared/domain-types";
import { describe, expect, it, vi } from "vitest";
import { SessionService, type SessionServiceDeps } from "./sessionService";

const TASK_ID = "task-1";
const RUN_ID = "run-1";

function turnComplete(): StoredLogEntry {
  return {
    type: "notification",
    notification: {
      method: "_posthog/turn_complete",
      params: { sessionId: RUN_ID, stopReason: "end_turn" },
    },
  };
}

function permissionRequest(
  requestId: string,
  toolCallId: string,
): StoredLogEntry {
  return {
    type: "notification",
    notification: {
      method: "_posthog/permission_request",
      params: {
        requestId,
        toolCall: { toolCallId, title: "Run command", kind: "execute" },
        options: [],
      },
    },
  };
}

function createHarness() {
  const sessions: Record<string, AgentSession> = {};
  const store = {
    getSessions: () => sessions,
    getSessionByTaskId: (taskId: string) =>
      Object.values(sessions).find((s) => s.taskId === taskId),
    setSession: (session: AgentSession) => {
      sessions[session.taskRunId] = session;
    },
    updateSession: (taskRunId: string, updates: Partial<AgentSession>) => {
      const session = sessions[taskRunId];
      if (session) Object.assign(session, updates);
    },
    appendEvents: (
      taskRunId: string,
      events: AgentSession["events"],
      newLineCount?: number,
    ) => {
      const session = sessions[taskRunId];
      if (!session) return;
      session.events = [...session.events, ...events];
      if (newLineCount !== undefined) {
        session.processedLineCount = newLineCount;
      }
    },
    updateCloudStatus: (
      taskRunId: string,
      fields: { status?: AgentSession["cloudStatus"] },
    ) => {
      const session = sessions[taskRunId];
      if (session && fields.status !== undefined) {
        session.cloudStatus = fields.status;
      }
    },
    setPendingPermissions: (
      taskRunId: string,
      permissions: AgentSession["pendingPermissions"],
    ) => {
      const session = sessions[taskRunId];
      if (session) session.pendingPermissions = permissions;
    },
    clearTailOptimisticItems: vi.fn(),
    appendOptimisticItem: vi.fn(),
    replaceOptimisticWithEvent: vi.fn(),
    clearMessageQueue: vi.fn(),
  };

  let onUpdate: ((update: CloudTaskUpdatePayload) => void) | undefined;
  const notifyPromptComplete = vi.fn();
  const notifyPermissionRequest = vi.fn();
  const markActivity = vi.fn();
  const noopLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const deps = {
    store,
    log: noopLog,
    notifyPromptComplete,
    notifyPermissionRequest,
    taskViewedApi: { markActivity },
    getPersistedConfigOptions: () => undefined,
    setPersistedConfigOptions: vi.fn(),
    trpc: {
      agent: {
        onSessionIdleKilled: {
          subscribe: () => ({ unsubscribe: vi.fn() }),
        },
        getPreviewConfigOptions: {
          query: vi.fn().mockResolvedValue([]),
        },
      },
      logs: {
        readLocalLogs: { query: vi.fn().mockResolvedValue("") },
      },
      cloudTask: {
        onUpdate: {
          subscribe: (
            _input: unknown,
            handlers: { onData: (update: CloudTaskUpdatePayload) => void },
          ) => {
            onUpdate = handlers.onData;
            return { unsubscribe: vi.fn() };
          },
        },
        watch: { mutate: vi.fn().mockResolvedValue(undefined) },
        unwatch: { mutate: vi.fn().mockResolvedValue(undefined) },
      },
    },
  } as unknown as SessionServiceDeps;

  const service = new SessionService(deps);
  service.watchCloudTask(TASK_ID, RUN_ID, "https://us.posthog.com", 1);
  if (!onUpdate) throw new Error("watchCloudTask did not subscribe");

  return {
    sendUpdate: (update: CloudTaskUpdatePayload) => onUpdate?.(update),
    notifyPromptComplete,
    notifyPermissionRequest,
    markActivity,
  };
}

describe("cloud task update notifications", () => {
  it("does not notify for turn_completes replayed in a snapshot", () => {
    const harness = createHarness();

    harness.sendUpdate({
      taskId: TASK_ID,
      runId: RUN_ID,
      kind: "snapshot",
      newEntries: [turnComplete(), turnComplete(), turnComplete()],
      totalEntryCount: 3,
    });

    expect(harness.notifyPromptComplete).not.toHaveBeenCalled();
    expect(harness.markActivity).not.toHaveBeenCalled();
  });

  it("notifies once for a live turn_complete delta after the snapshot", () => {
    const harness = createHarness();
    harness.sendUpdate({
      taskId: TASK_ID,
      runId: RUN_ID,
      kind: "snapshot",
      newEntries: [turnComplete(), turnComplete()],
      totalEntryCount: 2,
    });

    harness.sendUpdate({
      taskId: TASK_ID,
      runId: RUN_ID,
      kind: "logs",
      newEntries: [turnComplete()],
      totalEntryCount: 3,
    });

    expect(harness.notifyPromptComplete).toHaveBeenCalledTimes(1);
    expect(harness.notifyPromptComplete).toHaveBeenCalledWith(
      "Cloud Task",
      "end_turn",
      TASK_ID,
      undefined,
    );
    expect(harness.markActivity).toHaveBeenCalledTimes(1);
  });

  it("notifies a pending permission once across repeated snapshots", () => {
    const harness = createHarness();
    const snapshot = () =>
      harness.sendUpdate({
        taskId: TASK_ID,
        runId: RUN_ID,
        kind: "snapshot",
        newEntries: [permissionRequest("r1", "t1")],
        totalEntryCount: 1,
      });

    snapshot();
    expect(harness.notifyPermissionRequest).toHaveBeenCalledTimes(1);

    snapshot();
    snapshot();
    expect(harness.notifyPermissionRequest).toHaveBeenCalledTimes(1);
  });

  it("notifies again when the same tool call asks with a new requestId", () => {
    const harness = createHarness();
    harness.sendUpdate({
      taskId: TASK_ID,
      runId: RUN_ID,
      kind: "snapshot",
      newEntries: [permissionRequest("r1", "t1")],
      totalEntryCount: 1,
    });
    expect(harness.notifyPermissionRequest).toHaveBeenCalledTimes(1);

    harness.sendUpdate({
      taskId: TASK_ID,
      runId: RUN_ID,
      kind: "permission_request",
      requestId: "r2",
      toolCall: { toolCallId: "t1", title: "Run command", kind: "execute" },
      options: [],
    });
    expect(harness.notifyPermissionRequest).toHaveBeenCalledTimes(2);
  });
});
