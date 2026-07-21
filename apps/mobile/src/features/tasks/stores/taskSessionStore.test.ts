import type { CloudTaskSession } from "@posthog/core/sessions/cloudTaskSessionService";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getTaskSession,
  taskSessionStatePort,
  useTaskSessionStore,
} from "./taskSessionStore";

function session(overrides: Partial<CloudTaskSession> = {}): CloudTaskSession {
  return {
    taskId: "task-1",
    taskRunId: "run-1",
    events: [],
    status: "connected",
    isPromptPending: false,
    ...overrides,
  };
}

describe("taskSessionStatePort", () => {
  beforeEach(() => {
    useTaskSessionStore.setState({ sessions: {}, focusedTaskId: null });
  });

  it("indexes sessions by both task and run", () => {
    taskSessionStatePort.set(session());

    expect(getTaskSession("task-1")?.taskRunId).toBe("run-1");
  });

  it("updates one session without replacing the others", () => {
    taskSessionStatePort.set(session());
    taskSessionStatePort.set(session({ taskId: "task-2", taskRunId: "run-2" }));

    taskSessionStatePort.update("run-1", (current) => ({
      ...current,
      isPromptPending: true,
    }));

    expect(useTaskSessionStore.getState().sessions["run-2"]?.taskId).toBe(
      "task-2",
    );
  });

  it("removes sessions by run id", () => {
    taskSessionStatePort.set(session());

    taskSessionStatePort.remove("run-1");

    expect(getTaskSession("task-1")).toBeUndefined();
  });
});
