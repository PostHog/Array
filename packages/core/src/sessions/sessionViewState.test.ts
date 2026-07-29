import type { AgentSession } from "@posthog/shared";
import type { Task, TaskRunStatus } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import { deriveSessionViewState } from "./sessionViewState";

function makeEvent(): AgentSession["events"][number] {
  return {
    type: "acp_message",
    ts: 1,
    message: { jsonrpc: "2.0", method: "noop", params: {} },
  };
}

function makeTask(runStatus: TaskRunStatus, runId = "run-1"): Task {
  return {
    id: "task-1",
    task_number: 1,
    slug: "task-1",
    title: "Task",
    description: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    origin_product: "user_created",
    latest_run: {
      id: runId,
      status: runStatus,
      environment: "cloud",
    } as Task["latest_run"],
  };
}

function makeSession(
  cloudStatus: TaskRunStatus,
  taskRunId = "run-1",
  overrides: Partial<AgentSession> = {},
): AgentSession {
  return {
    taskId: "task-1",
    taskRunId,
    taskTitle: "Task",
    channel: `agent-event:${taskRunId}`,
    status: "connected",
    events: [],
    startedAt: 0,
    isCloud: true,
    cloudStatus,
    isPromptPending: false,
    isCompacting: false,
    promptStartedAt: null,
    pendingPermissions: new Map(),
    pausedDurationMs: 0,
    messageQueue: [],
    optimisticItems: [],
    ...overrides,
  };
}

describe("deriveSessionViewState", () => {
  it("uses terminal task status over stale same-run session status", () => {
    const state = deriveSessionViewState(
      makeSession("in_progress"),
      makeTask("completed"),
      null,
      true,
    );

    expect(state.cloudStatus).toBe("completed");
    expect(state.isCloudRunTerminal).toBe(true);
    expect(state.isInitializing).toBe(false);
  });

  it("uses the task status when the session belongs to an older run", () => {
    const state = deriveSessionViewState(
      makeSession("completed", "old-run"),
      makeTask("in_progress", "new-run"),
      null,
      true,
    );

    expect(state.cloudStatus).toBe("in_progress");
    expect(state.isCloudRunNotTerminal).toBe(true);
  });

  it("treats not_started as a non-terminal cloud state", () => {
    const state = deriveSessionViewState(
      undefined,
      makeTask("not_started"),
      null,
      true,
    );

    expect(state.cloudStatus).toBe("not_started");
    expect(state.isCloudRunNotTerminal).toBe(true);
    expect(state.isCloudRunTerminal).toBe(false);
    expect(state.isInitializing).toBe(true);
    expect(state.hasRestorableContent).toBe(false);
  });

  it("flags restorable content while a resume run is queued but the session still points at the old run", () => {
    // The resume window where the message used to vanish: the user just sent
    // a follow-up on the terminal run, task.latest_run has flipped to the new
    // (non-terminal) run, and the resolved cloud status is non-terminal while
    // the session's transcript has no events yet. The just-sent message lives
    // only in optimisticItems — the UI must not hide it behind the
    // full-screen initializing overlay.
    const state = deriveSessionViewState(
      makeSession("completed", "old-run", {
        optimisticItems: [
          {
            type: "user_message",
            id: "opt-1",
            content: "follow up please",
            timestamp: 123,
            pinToTop: false,
          },
        ],
      }),
      makeTask("queued", "new-run"),
      null,
      true,
    );

    expect(state.isInitializing).toBe(true);
    expect(state.hasRestorableContent).toBe(true);
  });

  it("flags restorable content from optimistic items alone (events not yet replayed)", () => {
    const state = deriveSessionViewState(
      makeSession("completed", "old-run", {
        optimisticItems: [
          {
            type: "user_message",
            id: "opt-1",
            content: "follow up please",
            timestamp: 123,
            pinToTop: false,
          },
        ],
      }),
      makeTask("in_progress", "new-run"),
      null,
      true,
    );

    expect(state.isInitializing).toBe(true);
    expect(state.hasRestorableContent).toBe(true);
  });

  it("flags restorable content once the new session carries the prior transcript", () => {
    // After resumeCloudRun swaps the session, events are carried onto the new
    // run's session — even if cloudStatus fields are not populated yet, the
    // thread must remain visible.
    const state = deriveSessionViewState(
      makeSession("in_progress", "new-run", {
        events: [makeEvent()],
      }),
      makeTask("in_progress", "new-run"),
      null,
      true,
    );

    expect(state.isInitializing).toBe(false);
    expect(state.hasRestorableContent).toBe(true);
  });

  it("does not flag restorable content for a brand-new blank cloud task", () => {
    const state = deriveSessionViewState(
      undefined,
      makeTask("in_progress"),
      null,
      true,
    );

    expect(state.isInitializing).toBe(true);
    expect(state.hasRestorableContent).toBe(false);
  });

  it("never flags restorable content for local sessions", () => {
    const state = deriveSessionViewState(
      makeSession("in_progress", "run-1", {
        events: [makeEvent()],
      }),
      makeTask("in_progress"),
      null,
      false,
    );

    expect(state.hasRestorableContent).toBe(false);
  });
});
