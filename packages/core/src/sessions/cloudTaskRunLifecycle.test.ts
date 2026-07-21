import { describe, expect, it, vi } from "vitest";
import { CloudTaskCommandController } from "./cloudTaskCommandController";
import {
  CloudTaskRunLifecycle,
  type CloudTaskRunSession,
} from "./cloudTaskRunLifecycle";

function createHarness() {
  const sendCommand = vi.fn(async () => undefined);
  const stopRun = vi.fn(async () => undefined);
  const update = vi.fn();
  let current: CloudTaskRunSession | undefined = session;
  const lifecycle = new CloudTaskRunLifecycle(
    new CloudTaskCommandController({ sendCommand, stopRun }),
    {
      get: () => current,
      update: (taskRunId, patch) => {
        update(taskRunId, patch);
        if (current?.taskRunId === taskRunId)
          current = { ...current, ...patch };
      },
    },
  );
  return {
    lifecycle,
    stopRun,
    update,
    setCurrent: (next: CloudTaskRunSession) => {
      current = next;
    },
    getCurrent: () => current,
  };
}

const session: CloudTaskRunSession = {
  taskRunId: "run-1",
  stopRequested: false,
  isPromptPending: true,
  promptStartedAt: 123,
  activityVersion: 1,
};

describe("CloudTaskRunLifecycle", () => {
  it("marks a mounted session stopping before dispatch", async () => {
    const { lifecycle, stopRun, update } = createHarness();

    await lifecycle.stopRun({ taskId: "task-1", taskRunId: "run-1" }, session);

    expect(update).toHaveBeenCalledWith("run-1", {
      stopRequested: true,
      isPromptPending: false,
      promptStartedAt: null,
    });
    expect(stopRun).toHaveBeenCalledWith({
      taskId: "task-1",
      taskRunId: "run-1",
    });
  });

  it("restores prompt state when stopping fails", async () => {
    const { lifecycle, stopRun, update } = createHarness();
    stopRun.mockRejectedValueOnce(new Error("failed"));

    await expect(
      lifecycle.stopRun({ taskId: "task-1", taskRunId: "run-1" }, session),
    ).rejects.toThrow("failed");

    expect(update).toHaveBeenLastCalledWith("run-1", {
      stopRequested: false,
      isPromptPending: true,
      promptStartedAt: 123,
    });
  });

  it("stops an unmounted run without writing session state", async () => {
    const { lifecycle, update } = createHarness();

    await lifecycle.stopRun({ taskId: "task-1", taskRunId: "run-1" });

    expect(update).not.toHaveBeenCalled();
  });

  it("does not restore stale prompt state after newer activity", async () => {
    let rejectStop: (error: Error) => void = () => undefined;
    const { lifecycle, stopRun, setCurrent, getCurrent } = createHarness();
    stopRun.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectStop = reject;
        }),
    );

    const stopping = lifecycle.stopRun(
      { taskId: "task-1", taskRunId: "run-1" },
      session,
    );
    setCurrent({
      ...session,
      stopRequested: true,
      isPromptPending: false,
      promptStartedAt: null,
      activityVersion: 2,
    });
    rejectStop(new Error("failed"));

    await expect(stopping).rejects.toThrow("failed");
    expect(getCurrent()).toEqual({
      ...session,
      stopRequested: true,
      isPromptPending: false,
      promptStartedAt: null,
      activityVersion: 2,
    });
  });
});
