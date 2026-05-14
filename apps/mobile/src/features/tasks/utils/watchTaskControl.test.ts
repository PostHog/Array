import { describe, expect, it } from "vitest";
import type { Task, TaskRunStatus } from "../types";
import { createWatchTaskSnapshot } from "./watchTaskControl";

function taskWithRunStatus(status: TaskRunStatus): Task {
  return {
    id: "task-1",
    task_number: 1,
    slug: "task-1",
    title: "Test task",
    description: "Test task description",
    created_at: "2026-05-14T00:00:00.000Z",
    updated_at: "2026-05-14T00:01:00.000Z",
    origin_product: "user_created",
    repository: "PostHog/code",
    internal: false,
    latest_run: {
      id: "run-1",
      task: "task-1",
      team: 1,
      branch: null,
      environment: "cloud",
      status,
      log_url: "",
      error_message: null,
      output: null,
      state: {},
      created_at: "2026-05-14T00:00:00.000Z",
      updated_at: "2026-05-14T00:01:00.000Z",
      completed_at: status === "completed" ? "2026-05-14T00:02:00.000Z" : null,
    },
  };
}

describe("watchTaskControl", () => {
  it("does not treat non-terminal backend run status as actively running", () => {
    const snapshot = createWatchTaskSnapshot(taskWithRunStatus("in_progress"));

    expect(snapshot.status).toBe("idle");
    expect(snapshot.statusText).toBe("Idle");
  });

  it("does not keep showing running from stale tool progress after prompt stops", () => {
    const snapshot = createWatchTaskSnapshot(taskWithRunStatus("in_progress"), {
      taskId: "task-1",
      taskRunId: "run-1",
      taskTitle: "Test task",
      events: [
        {
          type: "session_update",
          ts: Date.now(),
          notification: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-1",
              title: "Long running tool",
              status: "in_progress",
              _meta: { claudeCode: { toolName: "Task" } },
            },
          },
        },
      ],
      status: "connected",
      isPromptPending: false,
      awaitingAgentOutput: false,
    } as never);

    expect(snapshot.progress.running).toBe(1);
    expect(snapshot.status).toBe("idle");
    expect(snapshot.statusText).toBe("Idle");
  });

  it("still maps terminal backend run status", () => {
    const snapshot = createWatchTaskSnapshot(taskWithRunStatus("completed"));

    expect(snapshot.status).toBe("completed");
    expect(snapshot.statusText).toBe("Completed");
  });
});
