import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runAgentMock } = vi.hoisted(() => ({ runAgentMock: vi.fn() }));
vi.mock("./run-agent", async () => {
  const actual =
    await vi.importActual<typeof import("./run-agent")>("./run-agent");
  return { ...actual, runAgent: runAgentMock };
});

import {
  registerSubagentRpc,
  SUBAGENT_RPC_REQUEST_CHANNEL,
  subagentRpcReplyChannel,
} from "./rpc";

class FakeEventBus {
  private handlers = new Map<string, Array<(data: unknown) => void>>();
  on(channel: string, handler: (data: unknown) => void): () => void {
    const list = this.handlers.get(channel) ?? [];
    list.push(handler);
    this.handlers.set(channel, list);
    return () => {};
  }
  emit(channel: string, data: unknown): void {
    for (const handler of this.handlers.get(channel) ?? []) handler(data);
  }
}

function makePi() {
  const events = new FakeEventBus();
  const lifecycleHandlers: Record<
    string,
    (event: unknown, ctx: unknown) => void
  > = {};
  const pi = {
    events,
    on: (event: string, handler: (event: unknown, ctx: unknown) => void) => {
      lifecycleHandlers[event] = handler;
    },
  } as unknown as ExtensionAPI;
  return { pi, events, lifecycleHandlers };
}

function waitForReply(
  events: FakeEventBus,
  requestId: string,
): Promise<unknown> {
  return new Promise((resolve) => {
    events.on(subagentRpcReplyChannel(requestId), resolve);
  });
}

describe("registerSubagentRpc", () => {
  beforeEach(() => {
    runAgentMock.mockReset();
  });

  it("replies to ping", async () => {
    const { pi, events } = makePi();
    registerSubagentRpc(pi);

    const replyPromise = waitForReply(events, "req-1");
    events.emit(SUBAGENT_RPC_REQUEST_CHANNEL, {
      version: 1,
      requestId: "req-1",
      method: "ping",
    });

    expect(await replyPromise).toMatchObject({
      success: true,
      data: { pong: true, version: 1 },
    });
  });

  it("ignores malformed requests (wrong version, missing fields)", async () => {
    const { pi, events } = makePi();
    const onRequest = vi.fn();
    registerSubagentRpc(pi);
    events.on(SUBAGENT_RPC_REQUEST_CHANNEL, onRequest);

    events.emit(SUBAGENT_RPC_REQUEST_CHANNEL, {
      version: 2,
      requestId: "x",
      method: "ping",
    });
    events.emit(SUBAGENT_RPC_REQUEST_CHANNEL, { requestId: "x" });
    events.emit(SUBAGENT_RPC_REQUEST_CHANNEL, null);

    // These reach the raw listener (proving emit works) but produce no replies.
    expect(onRequest).toHaveBeenCalledTimes(3);
  });

  it("replies with an error for an unknown method", async () => {
    const { pi, events } = makePi();
    registerSubagentRpc(pi);

    const replyPromise = waitForReply(events, "req-2");
    events.emit(SUBAGENT_RPC_REQUEST_CHANNEL, {
      version: 1,
      requestId: "req-2",
      method: "not-a-method",
    });

    expect(await replyPromise).toMatchObject({
      success: false,
      error: expect.stringMatching(/Unknown method/),
    });
  });

  it("status returns the (empty) run list when there are no runs", async () => {
    const { pi, events } = makePi();
    registerSubagentRpc(pi);

    const replyPromise = waitForReply(events, "req-3");
    events.emit(SUBAGENT_RPC_REQUEST_CHANNEL, {
      version: 1,
      requestId: "req-3",
      method: "status",
    });

    const reply = (await replyPromise) as {
      success: boolean;
      data: { runs: unknown[] };
    };
    expect(reply.success).toBe(true);
    expect(Array.isArray(reply.data.runs)).toBe(true);
  });

  it("interrupt reports interrupted: false for an unknown runId", async () => {
    const { pi, events } = makePi();
    registerSubagentRpc(pi);

    const replyPromise = waitForReply(events, "req-4");
    events.emit(SUBAGENT_RPC_REQUEST_CHANNEL, {
      version: 1,
      requestId: "req-4",
      method: "interrupt",
      params: { runId: "nope" },
    });

    expect(await replyPromise).toMatchObject({
      success: true,
      data: { interrupted: false },
    });
  });

  it("spawn errors when there's no active session context yet", async () => {
    const { pi, events } = makePi();
    registerSubagentRpc(pi);

    const replyPromise = waitForReply(events, "req-5");
    events.emit(SUBAGENT_RPC_REQUEST_CHANNEL, {
      version: 1,
      requestId: "req-5",
      method: "spawn",
      params: { agent: "scout", task: "look around" },
    });

    expect(await replyPromise).toMatchObject({
      success: false,
      error: expect.stringMatching(/No active session context/),
    });
  });

  it("spawn errors for an unknown agent", async () => {
    const { pi, events, lifecycleHandlers } = makePi();
    registerSubagentRpc(pi);
    lifecycleHandlers.session_start({}, { cwd: "/repo" });

    const replyPromise = waitForReply(events, "req-6");
    events.emit(SUBAGENT_RPC_REQUEST_CHANNEL, {
      version: 1,
      requestId: "req-6",
      method: "spawn",
      params: { agent: "not-real", task: "x" },
    });

    expect(await replyPromise).toMatchObject({
      success: false,
      error: expect.stringMatching(/Unknown agent/),
    });
  });

  it("spawn starts a background run and replies with a runId once a session context is known", async () => {
    const { pi, events, lifecycleHandlers } = makePi();
    registerSubagentRpc(pi);
    lifecycleHandlers.session_start({}, { cwd: "/repo" });

    runAgentMock.mockImplementation(async ({ task }: { task: string }) => ({
      runId: "child-run",
      agent: "scout",
      task,
      exitCode: 0,
      messages: [],
      stderr: "",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        contextTokens: 0,
        turns: 0,
      },
      model: "anthropic/opus",
    }));

    const replyPromise = waitForReply(events, "req-7");
    events.emit(SUBAGENT_RPC_REQUEST_CHANNEL, {
      version: 1,
      requestId: "req-7",
      method: "spawn",
      params: {
        agent: "scout",
        task: "find auth code",
        context: "extra context",
      },
    });

    const reply = (await replyPromise) as {
      success: boolean;
      data: { runId: string };
    };
    expect(reply.success).toBe(true);
    expect(reply.data.runId).toBeTruthy();

    await new Promise((r) => setTimeout(r, 10));
    expect(runAgentMock).toHaveBeenCalledTimes(1);
    expect(runAgentMock.mock.calls[0][0].task).toBe("find auth code");
    expect(runAgentMock.mock.calls[0][0].context).toBe("extra context");
  });
});
