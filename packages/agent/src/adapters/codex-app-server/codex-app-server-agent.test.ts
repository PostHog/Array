import type {
  AgentSideConnection,
  InitializeRequest,
  NewSessionRequest,
  PromptRequest,
} from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import type {
  AppServerClientHandlers,
  AppServerRpc,
} from "./app-server-client";
import { CodexAppServerAgent } from "./codex-app-server-agent";

function makeStubRpc(responses: Record<string, unknown>) {
  let handlers: AppServerClientHandlers | undefined;
  const requests: Array<{ method: string; params?: unknown }> = [];

  const rpc: AppServerRpc = {
    async request<T = unknown>(method: string, params?: unknown): Promise<T> {
      requests.push({ method, params });
      return (responses[method] ?? {}) as T;
    },
    notify() {},
    async close() {},
  };

  return {
    requests,
    factory(captured: AppServerClientHandlers): AppServerRpc {
      handlers = captured;
      return rpc;
    },
    emit(method: string, params: unknown) {
      handlers?.onNotification?.(method, params);
    },
    invokeRequest(method: string, params: unknown): Promise<unknown> {
      if (!handlers?.onRequest) throw new Error("no onRequest handler");
      return handlers.onRequest(method, params);
    },
    triggerClose() {
      handlers?.onClose?.();
    },
  };
}

function makeFakeClient(
  outcome: unknown = { outcome: "selected", optionId: "allow" },
) {
  const sessionUpdates: unknown[] = [];
  const client = {
    sessionUpdate: async (notification: unknown) => {
      sessionUpdates.push(notification);
    },
    requestPermission: async () => ({ outcome }),
  } as unknown as AgentSideConnection;
  return { client, sessionUpdates };
}

const init = { protocolVersion: 1 } as unknown as InitializeRequest;

describe("CodexAppServerAgent", () => {
  it("runs initialize -> thread/start -> turn/start and streams agent text", async () => {
    const stub = makeStubRpc({
      initialize: {},
      "thread/start": { thread: { id: "thr_1" } },
      "turn/start": { turn: { id: "turn_1", status: "inProgress" } },
    });
    const { client, sessionUpdates } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/bundle/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });

    await agent.initialize(init);
    const session = await agent.newSession({
      cwd: "/repo",
    } as unknown as NewSessionRequest);
    expect(session.sessionId).toBe("thr_1");

    const promptDone = agent.prompt({
      sessionId: "thr_1",
      prompt: [{ type: "text", text: "hello" }],
    } as unknown as PromptRequest);

    stub.emit("item/agentMessage/delta", { itemId: "i1", text: "Hi there" });
    stub.emit("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });

    const result = await promptDone;
    expect(result.stopReason).toBe("end_turn");
    expect(sessionUpdates).toContainEqual({
      sessionId: "thr_1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hi there" },
      },
    });

    const turnStart = stub.requests.find((r) => r.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      threadId: "thr_1",
      input: [{ type: "text", text: "hello" }],
    });
  });

  it("maps a failed turn to a refusal stop reason", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [],
    } as unknown as PromptRequest);
    stub.emit("turn/completed", { turn: { status: "failed" } });

    expect((await done).stopReason).toBe("refusal");
  });

  it("routes command approvals to the host and maps allow to accept", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const decision = await stub.invokeRequest(
      "item/commandExecution/requestApproval",
      { itemId: "i", command: "ls -la" },
    );

    expect(decision).toBe("accept");
  });

  it("rejects the pending turn when the app-server stream closes", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "hi" }],
    } as unknown as PromptRequest);

    stub.triggerClose();

    await expect(done).rejects.toThrow(/exited before the turn completed/);
  });

  it("interrupts by sending turn/interrupt before reporting cancelled", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [],
    } as unknown as PromptRequest);

    await agent.cancel({ sessionId: "t" });

    expect((await done).stopReason).toBe("cancelled");
    expect(stub.requests.some((r) => r.method === "turn/interrupt")).toBe(true);
  });

  it("rejects a concurrent prompt while a turn is in progress", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const first = agent.prompt({
      sessionId: "t",
      prompt: [],
    } as unknown as PromptRequest);

    await expect(
      agent.prompt({ sessionId: "t", prompt: [] } as unknown as PromptRequest),
    ).rejects.toThrow(/already in progress/);

    stub.emit("turn/completed", { turn: { status: "completed" } });
    await first;
  });

  it("runs sequential turns on the same session", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);

    const first = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "one" }],
    } as unknown as PromptRequest);
    stub.emit("turn/completed", { turn: { status: "completed" } });
    expect((await first).stopReason).toBe("end_turn");

    const second = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "two" }],
    } as unknown as PromptRequest);
    stub.emit("turn/completed", { turn: { status: "completed" } });
    expect((await second).stopReason).toBe("end_turn");
  });

  it("maps a rejected approval to decline", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient({
      outcome: "selected",
      optionId: "reject",
    });
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    expect(
      await stub.invokeRequest("item/fileChange/requestApproval", {
        itemId: "i",
      }),
    ).toBe("decline");
  });

  it("maps a cancelled approval to cancel", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient({ outcome: "cancelled" });
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    expect(
      await stub.invokeRequest("item/commandExecution/requestApproval", {
        itemId: "i",
        command: "ls",
      }),
    ).toBe("cancel");
  });
});
