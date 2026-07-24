import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiAgentServer } from "./pi-agent-server";
import type { AgentServerConfig } from "./types";

function config(): AgentServerConfig {
  return {
    port: 0,
    jwtPublicKey: "public-key",
    apiUrl: "https://us.posthog.com",
    apiKey: "token",
    projectId: 1,
    mode: "interactive",
    taskId: "task-1",
    runId: "run-1",
    sandboxId: "sandbox-1",
  };
}

describe("PiAgentServer", () => {
  it.each([
    ["task", { task_id: "task-2", run_id: "run-1", team_id: 1 }],
    ["run", { task_id: "task-1", run_id: "run-2", team_id: 1 }],
    ["team", { task_id: "task-1", run_id: "run-1", team_id: 2 }],
  ])("rejects a token for a different %s", (_field, identity) => {
    const server = new PiAgentServer(config()) as unknown as {
      assertConfiguredRun(payload: Record<string, unknown>): void;
    };

    expect(() =>
      server.assertConfiguredRun({
        ...identity,
        user_id: 1,
        distinct_id: "user-1",
        mode: "interactive",
      }),
    ).toThrow("Token does not match the configured task run");
  });

  it("persists translated Pi events at the turn boundary", async () => {
    const appendTaskRunLog = vi.fn(async () => ({}));
    const server = new PiAgentServer(config()) as unknown as {
      posthogAPI: { appendTaskRunLog: typeof appendTaskRunLog };
      handleEvent(event: Record<string, unknown>): void;
      logFlushQueue: Promise<void>;
    };
    server.posthogAPI.appendTaskRunLog = appendTaskRunLog;

    server.handleEvent({
      type: "user_message",
      timestamp: 1,
      content: [{ type: "text", text: "hello" }],
    });
    server.handleEvent({ type: "turn_completed", timestamp: 2 });
    await server.logFlushQueue;

    expect(appendTaskRunLog).toHaveBeenCalledWith("task-1", "run-1", [
      {
        type: "pi_event",
        timestamp: expect.any(String),
        event: {
          type: "user_message",
          timestamp: 1,
          content: [{ type: "text", text: "hello" }],
        },
      },
      {
        type: "pi_event",
        timestamp: expect.any(String),
        event: { type: "turn_completed", timestamp: 2 },
      },
    ]);
  });

  it("uses native Pi prompt for an idle cloud user message", async () => {
    const prompt = vi.fn(async () => {});
    const followUp = vi.fn(async () => {});
    const server = new PiAgentServer(config()) as unknown as {
      session: unknown;
      executeCommand(
        method: string,
        params: Record<string, unknown>,
      ): Promise<unknown>;
    };
    server.session = {
      runtime: {
        client: {
          getState: vi.fn(async () => ({ isStreaming: false })),
          prompt,
          followUp,
        },
      },
    };

    await server.executeCommand("user_message", { content: "hello" });

    expect(prompt).toHaveBeenCalledWith("hello");
    expect(followUp).not.toHaveBeenCalled();
  });

  it("allows a failed user-message delivery to be retried", async () => {
    const prompt = vi
      .fn()
      .mockRejectedValueOnce(new Error("delivery failed"))
      .mockResolvedValueOnce(undefined);
    const server = new PiAgentServer(config()) as unknown as {
      session: unknown;
      executeCommand(
        method: string,
        params: Record<string, unknown>,
      ): Promise<unknown>;
    };
    server.session = {
      runtime: {
        client: {
          getState: vi.fn(async () => ({ isStreaming: false })),
          prompt,
        },
      },
    };
    const params = { content: "hello", messageId: "message-1" };

    await expect(server.executeCommand("user_message", params)).rejects.toThrow(
      "delivery failed",
    );
    await expect(
      server.executeCommand("user_message", params),
    ).resolves.toBeUndefined();

    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("does not install an SSE controller canceled during initialization", async () => {
    let finishInitialization: (() => void) | undefined;
    const initializationGate = new Promise<void>((resolve) => {
      finishInitialization = resolve;
    });
    const controller = { send: vi.fn(), close: vi.fn() };
    const payload = { task_id: "task-1", run_id: "run-1" };
    type TestController = typeof controller;
    type TestPayload = typeof payload;
    const server = new PiAgentServer(config()) as unknown as {
      session: {
        payload: TestPayload;
        sseController: TestController | null;
      } | null;
      createSession(sessionPayload: TestPayload): Promise<void>;
      initializeSession(
        sessionPayload: TestPayload,
        sseController: TestController,
      ): Promise<void>;
      cancelSseController(sseController: TestController): void;
    };
    server.createSession = vi.fn(async (sessionPayload) => {
      await initializationGate;
      server.session = { payload: sessionPayload, sseController: null };
    });

    const initialization = server.initializeSession(payload, controller);
    server.cancelSseController(controller);
    finishInitialization?.();
    await initialization;

    expect(server.session?.sseController).toBeNull();
    expect(controller.send).not.toHaveBeenCalled();
  });

  it("preserves a replacement SSE controller when the old stream cancels", () => {
    const oldController = { send: vi.fn(), close: vi.fn() };
    const replacementController = { send: vi.fn(), close: vi.fn() };
    const server = new PiAgentServer(config()) as unknown as {
      session: { sseController: typeof replacementController } | null;
      cancelSseController(controller: typeof oldController): void;
    };
    server.session = { sseController: replacementController };

    server.cancelSseController(oldController);

    expect(server.session?.sseController).toBe(replacementController);

    server.cancelSseController(replacementController);

    expect(server.session?.sseController).toBeNull();
  });

  it("forwards native Pi RPC commands through the runtime", async () => {
    const sendCommand = vi.fn(async () => ({
      type: "response",
      command: "set_follow_up_mode",
      success: true,
    }));
    const server = new PiAgentServer(config()) as unknown as {
      session: unknown;
      executeCommand(
        method: string,
        params: Record<string, unknown>,
      ): Promise<unknown>;
    };
    server.session = { runtime: { client: {}, sendCommand } };
    const command = {
      type: "set_follow_up_mode",
      mode: "one-at-a-time",
    };

    const response = await server.executeCommand("pi/rpc", { command });

    expect(sendCommand).toHaveBeenCalledWith(command);
    expect(response).toEqual({
      type: "response",
      command: "set_follow_up_mode",
      success: true,
    });
  });

  it("waits for Pi to create the native session file before syncing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-sync-"));
    const syncTaskSession = vi.fn(async () => "content-hash");
    const server = new PiAgentServer(config()) as unknown as {
      sessionFile: string;
      posthogAPI: { syncTaskSession: typeof syncTaskSession };
      syncTaskSession(): Promise<void>;
    };
    server.sessionFile = join(directory, "not-created.jsonl");
    server.posthogAPI = { syncTaskSession };

    await server.syncTaskSession();

    expect(syncTaskSession).not.toHaveBeenCalled();
    await rm(directory, { recursive: true });
  });

  it("syncs changed native session JSONL to durable task storage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-sync-"));
    const sessionFile = join(directory, "session.jsonl");
    const content = '{"type":"session"}\n';
    await writeFile(sessionFile, content);
    const syncTaskSession = vi.fn(async () => "content-hash");
    const server = new PiAgentServer(config()) as unknown as {
      sessionFile: string;
      posthogAPI: { syncTaskSession: typeof syncTaskSession };
      syncTaskSession(): Promise<void>;
    };
    server.sessionFile = sessionFile;
    server.posthogAPI = { syncTaskSession };

    await server.syncTaskSession();
    await server.syncTaskSession();

    expect(syncTaskSession).toHaveBeenCalledOnce();
    expect(syncTaskSession).toHaveBeenCalledWith(
      "task-1",
      "run-1",
      "sandbox-1",
      null,
      content,
    );
    await rm(directory, { recursive: true });
  });

  it("publishes runtime-neutral Pi conversation events", () => {
    const send = vi.fn();
    const server = new PiAgentServer(config()) as unknown as {
      session: unknown;
      handleEvent(event: unknown): void;
    };
    server.session = { sseController: { send } };

    server.handleEvent({
      type: "assistant_message_chunk",
      timestamp: 1,
      content: { type: "text", text: "hello" },
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pi_event",
        event: expect.objectContaining({ type: "assistant_message_chunk" }),
      }),
    );
  });
});
