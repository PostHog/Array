import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));
vi.mock("../lib/cloudTaskStream", () => ({ watchCloudTask: vi.fn() }));
vi.mock("../composer/attachments/buildCloudPrompt", () => ({
  buildCloudPromptBlocks: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../utils/sounds", () => ({
  playMeepSound: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/features/notifications/lib/notifications", () => ({
  presentLocalNotification: vi.fn(() => Promise.resolve()),
}));
vi.mock("../api", () => ({
  CloudCommandError: class CloudCommandError extends Error {},
  getTask: vi.fn(),
  runTaskInCloud: vi.fn(),
  sendCloudCommand: vi.fn(),
}));

import { useMessageQueueStore } from "./messageQueueStore";
import { type TaskSession, useTaskSessionStore } from "./taskSessionStore";

function seedSession(overrides: Partial<TaskSession> = {}): void {
  const session: TaskSession = {
    taskRunId: "run-1",
    taskId: "t1",
    events: [],
    status: "connected",
    isPromptPending: true,
    ...overrides,
  };
  useTaskSessionStore.setState({ sessions: { "run-1": session } });
}

describe("steerQueuedMessage", () => {
  beforeEach(() => {
    useMessageQueueStore.setState({ queuesByTaskId: {} }, false);
    useTaskSessionStore.setState({ sessions: {} });
  });

  it("removes the message and resends it as a steer", async () => {
    seedSession();
    const sendInterrupting = vi.fn(() => Promise.resolve());
    useTaskSessionStore.setState({ sendInterrupting });

    useMessageQueueStore.getState().enqueue("t1", "first", []);
    useMessageQueueStore.getState().enqueue("t1", "second", []);
    const target = useMessageQueueStore.getState().getQueue("t1")[0];

    await useTaskSessionStore.getState().steerQueuedMessage("t1", target.id);

    expect(sendInterrupting).toHaveBeenCalledWith("t1", "first", []);
    expect(
      useMessageQueueStore
        .getState()
        .getQueue("t1")
        .map((m) => m.content),
    ).toEqual(["second"]);
  });

  it("rolls the message back onto the head when the resend fails", async () => {
    seedSession();
    const sendInterrupting = vi.fn(() => Promise.reject(new Error("boom")));
    useTaskSessionStore.setState({ sendInterrupting });

    useMessageQueueStore.getState().enqueue("t1", "first", []);
    useMessageQueueStore.getState().enqueue("t1", "second", []);
    const target = useMessageQueueStore.getState().getQueue("t1")[0];

    await expect(
      useTaskSessionStore.getState().steerQueuedMessage("t1", target.id),
    ).rejects.toThrow("boom");

    expect(
      useMessageQueueStore
        .getState()
        .getQueue("t1")
        .map((m) => m.content),
    ).toEqual(["first", "second"]);
  });

  it("no-ops while the session is compacting", async () => {
    seedSession({ isCompacting: true });
    const sendInterrupting = vi.fn(() => Promise.resolve());
    useTaskSessionStore.setState({ sendInterrupting });

    useMessageQueueStore.getState().enqueue("t1", "first", []);
    const target = useMessageQueueStore.getState().getQueue("t1")[0];

    await useTaskSessionStore.getState().steerQueuedMessage("t1", target.id);

    expect(sendInterrupting).not.toHaveBeenCalled();
    expect(
      useMessageQueueStore
        .getState()
        .getQueue("t1")
        .map((m) => m.content),
    ).toEqual(["first"]);
  });

  it("no-ops for an unknown message id", async () => {
    seedSession();
    const sendInterrupting = vi.fn(() => Promise.resolve());
    useTaskSessionStore.setState({ sendInterrupting });

    useMessageQueueStore.getState().enqueue("t1", "first", []);

    await useTaskSessionStore.getState().steerQueuedMessage("t1", "missing");

    expect(sendInterrupting).not.toHaveBeenCalled();
    expect(useMessageQueueStore.getState().getQueue("t1")).toHaveLength(1);
  });
});
