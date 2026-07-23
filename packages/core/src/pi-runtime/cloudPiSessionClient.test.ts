import type { TaskService } from "@posthog/core/task-detail/taskService";
import type { AgentConversationEvent } from "@posthog/shared";
import type { CloudTaskUpdatePayload } from "@posthog/shared/domain-types";
import { describe, expect, it, vi } from "vitest";
import type { CloudTaskClient } from "../cloud-task/cloudTaskClient";
import { CloudPiSessionClient } from "./cloudPiSessionClient";
import {
  PiSessionController,
  type PiSessionProvider,
} from "./piSessionController";

function createCloudTaskClient(autoStart = true) {
  let onUpdate: (update: CloudTaskUpdatePayload) => void = () => {};
  let onError: (error: unknown) => void = () => {};
  let onStarted: () => void = () => {};
  const unsubscribe = vi.fn();
  const client: CloudTaskClient = {
    getContext: vi.fn(async () => null),
    watch: vi.fn(async () => {}),
    unwatch: vi.fn(async () => {}),
    subscribe: vi.fn((_taskId, _runId, handler, errorHandler, started) => {
      onUpdate = handler;
      onError = errorHandler;
      onStarted = started;
      if (autoStart) {
        onStarted();
      }
      return unsubscribe;
    }),
    sendCommand: vi.fn(async () => ({ success: false })),
  };

  return {
    client,
    startSubscription: () => onStarted(),
    sendUpdate: (update: CloudTaskUpdatePayload) => onUpdate(update),
    sendError: (error: unknown) => onError(error),
    unsubscribe,
  };
}

function context(status: "queued" | "in_progress" | "completed") {
  return {
    taskId: "task-1",
    runId: "run-1",
    runStatus: status,
    apiHost: "https://us.posthog.com",
    teamId: 1,
  };
}

const snapshotEvent: AgentConversationEvent = {
  type: "assistant_message_chunk",
  timestamp: 1,
  content: { type: "text", text: "durable response" },
};

describe("CloudPiSessionClient", () => {
  it("waits for the native Pi readiness event before startup RPC commands", async () => {
    const cloud = createCloudTaskClient();
    vi.mocked(cloud.client.sendCommand).mockResolvedValue({
      success: true,
      result: {
        type: "response",
        command: "get_state",
        success: true,
        data: { isStreaming: true },
      },
    });
    const session = new CloudPiSessionClient(
      cloud.client,
      context("in_progress"),
    );
    session.onConversationEvent(vi.fn(), vi.fn());

    const state = session.client.getState();
    expect(cloud.client.sendCommand).not.toHaveBeenCalled();

    cloud.sendUpdate({
      taskId: "task-1",
      runId: "run-1",
      kind: "logs",
      newEntries: [{ type: "pi_run_started" }],
      totalEntryCount: 1,
    });

    await expect(state).resolves.toMatchObject({ isStreaming: true });
    expect(cloud.client.sendCommand).toHaveBeenCalledOnce();
  });

  it("ignores historical readiness events when resuming the same run", async () => {
    const cloud = createCloudTaskClient();
    vi.mocked(cloud.client.sendCommand).mockResolvedValue({
      success: true,
      result: {
        type: "response",
        command: "get_state",
        success: true,
        data: { isStreaming: false },
      },
    });
    const session = new CloudPiSessionClient(cloud.client, context("queued"));
    session.onConversationEvent(vi.fn(), vi.fn());

    const state = session.client.getState();
    cloud.sendUpdate({
      taskId: "task-1",
      runId: "run-1",
      kind: "snapshot",
      status: "in_progress",
      newEntries: [{ type: "pi_run_started" }],
      totalEntryCount: 1,
    });

    expect(cloud.client.sendCommand).not.toHaveBeenCalled();

    cloud.sendUpdate({
      taskId: "task-1",
      runId: "run-1",
      kind: "logs",
      newEntries: [{ type: "pi_run_started" }],
      totalEntryCount: 2,
    });

    await expect(state).resolves.toMatchObject({ isStreaming: false });
    expect(cloud.client.sendCommand).toHaveBeenCalledOnce();
  });

  it("waits for subscription readiness before watching and only unsubscribes on cleanup", async () => {
    const cloud = createCloudTaskClient(false);
    vi.mocked(cloud.client.watch).mockImplementation(async () => {
      cloud.sendUpdate({
        taskId: "task-1",
        runId: "run-1",
        kind: "snapshot",
        status: "completed",
        newEntries: [{ type: "pi_event", event: snapshotEvent }],
        totalEntryCount: 1,
      });
    });
    const session = new CloudPiSessionClient(
      cloud.client,
      context("completed"),
    );

    const cleanup = session.onConversationEvent(vi.fn(), vi.fn());
    const conversation = session.getConversation();
    expect(cloud.client.watch).not.toHaveBeenCalled();

    cloud.startSubscription();

    await expect(conversation).resolves.toEqual([snapshotEvent]);
    expect(cloud.client.watch).toHaveBeenCalledTimes(1);

    cleanup();
    expect(cloud.unsubscribe).toHaveBeenCalledTimes(1);
    expect(cloud.client.unwatch).not.toHaveBeenCalled();
  });

  it("rejects terminal history when the update subscription fails", async () => {
    const cloud = createCloudTaskClient();
    const session = new CloudPiSessionClient(
      cloud.client,
      context("completed"),
    );
    const onError = vi.fn();
    session.onConversationEvent(vi.fn(), onError);

    const conversation = session.getConversation();
    const error = new Error("subscription failed");
    cloud.sendError(error);

    await expect(conversation).rejects.toThrow("subscription failed");
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("streams provisioning progress before the Pi runtime is ready", () => {
    const cloud = createCloudTaskClient();
    const session = new CloudPiSessionClient(
      cloud.client,
      context("in_progress"),
    );
    const events: AgentConversationEvent[] = [];
    session.onConversationEvent((event) => events.push(event), vi.fn());

    cloud.sendUpdate({
      taskId: "task-1",
      runId: "run-1",
      kind: "logs",
      newEntries: [
        {
          type: "notification",
          timestamp: "2026-07-23T12:00:00.000Z",
          notification: {
            method: "_posthog/progress",
            params: {
              step: "sandbox",
              status: "in_progress",
              label: "Setting up sandbox",
              group: "setup:run-1",
            },
          },
        },
      ],
      totalEntryCount: 1,
    });

    expect(events).toEqual([
      {
        type: "progress",
        timestamp: Date.parse("2026-07-23T12:00:00.000Z"),
        step: "sandbox",
        status: "in_progress",
        label: "Setting up sandbox",
        group: "setup:run-1",
      },
    ]);
    expect(cloud.client.sendCommand).not.toHaveBeenCalled();
  });

  it("loads terminal history from the cloud snapshot without sandbox RPC", async () => {
    const cloud = createCloudTaskClient();
    const session = new CloudPiSessionClient(
      cloud.client,
      context("completed"),
    );
    const events: AgentConversationEvent[] = [];
    session.onConversationEvent((event) => events.push(event), vi.fn());

    const conversation = session.getConversation();
    cloud.sendUpdate({
      taskId: "task-1",
      runId: "run-1",
      kind: "snapshot",
      status: "completed",
      newEntries: [{ type: "pi_event", event: snapshotEvent }],
      totalEntryCount: 1,
    });

    await expect(conversation).resolves.toEqual([snapshotEvent]);
    expect(session.resumeRequired).toBe(true);
    await expect(session.health()).resolves.toEqual({ state: "cold" });
    await expect(session.client.getState()).resolves.toMatchObject({
      isStreaming: false,
    });
    await expect(session.client.getAvailableModels()).resolves.toEqual([]);
    await expect(session.client.getCommands()).resolves.toEqual([]);
    expect(events).toEqual([
      snapshotEvent,
      expect.objectContaining({ type: "turn_completed" }),
    ]);
    expect(cloud.client.sendCommand).not.toHaveBeenCalled();
  });

  it("does not install streaming state after a terminal snapshot arrives during controller load", async () => {
    const cloud = createCloudTaskClient();
    let resolveEntries: (result: { success: false; retryable: true }) => void =
      () => {};
    const entries = new Promise<{ success: false; retryable: true }>(
      (resolve) => {
        resolveEntries = resolve;
      },
    );
    vi.mocked(cloud.client.sendCommand).mockImplementation(async (input) => {
      const command = input.params?.command as { type: string };
      if (command.type === "get_entries") {
        return entries;
      }
      if (command.type === "get_state") {
        return {
          success: true,
          result: {
            type: "response",
            command: "get_state",
            success: true,
            data: {
              thinkingLevel: "off",
              isStreaming: true,
              isCompacting: false,
              steeringMode: "all",
              followUpMode: "all",
              sessionId: "run-1",
              autoCompactionEnabled: true,
              messageCount: 1,
              pendingMessageCount: 0,
            },
          },
        };
      }

      return { success: false };
    });
    const session = new CloudPiSessionClient(
      cloud.client,
      context("in_progress"),
    );
    const provider: PiSessionProvider = {
      get: vi.fn(async () => session),
    };
    const controller = new PiSessionController(provider, {} as TaskService);

    const connection = controller.connect("task-1");
    await vi.waitFor(() => {
      expect(cloud.client.subscribe).toHaveBeenCalledTimes(1);
    });
    cloud.sendUpdate({
      taskId: "task-1",
      runId: "run-1",
      kind: "logs",
      newEntries: [{ type: "pi_run_started" }],
      totalEntryCount: 1,
    });
    await vi.waitFor(() => {
      expect(cloud.client.sendCommand).toHaveBeenCalledTimes(1);
    });
    cloud.sendUpdate({
      taskId: "task-1",
      runId: "run-1",
      kind: "snapshot",
      status: "completed",
      newEntries: [{ type: "pi_event", event: snapshotEvent }],
      totalEntryCount: 1,
    });
    resolveEntries({ success: false, retryable: true });

    await connection;

    const controllerSession = controller.store.getState().sessions["task-1"];
    expect(controllerSession.events).toContain(snapshotEvent);
    expect(controllerSession.status).toMatchObject({ isStreaming: false });
  });

  it("switches to terminal state when the run finishes during an RPC", async () => {
    const cloud = createCloudTaskClient();
    const session = new CloudPiSessionClient(
      cloud.client,
      context("in_progress"),
    );
    session.onConversationEvent(vi.fn(), vi.fn());
    vi.mocked(cloud.client.sendCommand).mockImplementation(async () => {
      cloud.sendUpdate({
        taskId: "task-1",
        runId: "run-1",
        kind: "snapshot",
        status: "completed",
        newEntries: [{ type: "pi_event", event: snapshotEvent }],
        totalEntryCount: 1,
      });
      return { success: false, retryable: true };
    });
    cloud.sendUpdate({
      taskId: "task-1",
      runId: "run-1",
      kind: "logs",
      newEntries: [{ type: "pi_run_started" }],
      totalEntryCount: 1,
    });

    await expect(session.getConversation()).resolves.toEqual([snapshotEvent]);
    expect(cloud.client.sendCommand).toHaveBeenCalledTimes(1);
  });

  it("processes reconnect snapshots and clears streaming on terminal status", async () => {
    const cloud = createCloudTaskClient();
    const session = new CloudPiSessionClient(
      cloud.client,
      context("in_progress"),
    );
    const events: AgentConversationEvent[] = [];
    session.onConversationEvent((event) => events.push(event), vi.fn());

    cloud.sendUpdate({
      taskId: "task-1",
      runId: "run-1",
      kind: "snapshot",
      status: "in_progress",
      newEntries: [{ type: "pi_event", event: snapshotEvent }],
      totalEntryCount: 1,
    });
    cloud.sendUpdate({
      taskId: "task-1",
      runId: "run-1",
      kind: "snapshot",
      status: "in_progress",
      newEntries: [{ type: "pi_event", event: snapshotEvent }],
      totalEntryCount: 1,
    });
    cloud.sendUpdate({
      taskId: "task-1",
      runId: "run-1",
      kind: "status",
      status: "failed",
    });

    expect(events).toEqual([
      snapshotEvent,
      expect.objectContaining({ type: "turn_completed" }),
    ]);
    await expect(session.client.abort()).rejects.toThrow(
      "Cloud task run run-1 is failed",
    );
    expect(cloud.client.sendCommand).not.toHaveBeenCalled();
  });
});
