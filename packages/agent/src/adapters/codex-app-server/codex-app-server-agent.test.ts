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

// Required-field invariants the native codex app-server enforces on each request.
const REQUIRED_FIELDS: Record<string, string[]> = {
  "turn/interrupt": ["threadId", "turnId"],
  "turn/steer": ["threadId", "input", "expectedTurnId"],
};

function requiredFieldMissing(
  method: string,
  params: unknown,
): string | undefined {
  const p = (params ?? {}) as Record<string, unknown>;
  return REQUIRED_FIELDS[method]?.find(
    (f) => p[f] === undefined || p[f] === null || p[f] === "",
  );
}

function makeStubRpc(responses: Record<string, unknown>) {
  let handlers: AppServerClientHandlers | undefined;
  const requests: Array<{ method: string; params?: unknown }> = [];

  const rpc: AppServerRpc = {
    async request<T = unknown>(method: string, params?: unknown): Promise<T> {
      requests.push({ method, params });
      // Enforce the schema contract so a dropped required field fails loudly, not as a CI false-green.
      const missing = requiredFieldMissing(method, params);
      if (missing) {
        throw {
          code: -32600,
          message: `Invalid request: missing field \`${missing}\``,
        };
      }
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
  const extNotifications: Array<{ method: string; params: unknown }> = [];
  const client = {
    sessionUpdate: async (notification: unknown) => {
      sessionUpdates.push(notification);
    },
    requestPermission: async () => ({ outcome }),
    extNotification: async (method: string, params: unknown) => {
      extNotifications.push({ method, params });
    },
  } as unknown as AgentSideConnection;
  return { client, sessionUpdates, extNotifications };
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

    stub.emit("item/agentMessage/delta", { itemId: "i1", delta: "Hi there" });
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

  it("enriches an MCP tool-call approval with the structured posthog channel", async () => {
    const stub = makeStubRpc({
      initialize: {},
      "thread/start": { thread: { id: "thr_1" } },
    });
    const permissionToolCalls: unknown[] = [];
    const client = {
      sessionUpdate: async () => {},
      requestPermission: async (params: { toolCall: unknown }) => {
        permissionToolCalls.push(params.toolCall);
        return { outcome: { outcome: "selected", optionId: "allow" } };
      },
      extNotification: async () => {},
    } as unknown as AgentSideConnection;

    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/bundle/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    await agent.initialize(init);
    await agent.newSession({ cwd: "/repo" } as unknown as NewSessionRequest);

    // The MCP tool call item arrives first, then codex approves it via a command-execution request.
    stub.emit("item/started", {
      item: {
        type: "mcpToolCall",
        id: "m1",
        server: "posthog",
        tool: "exec",
        arguments: { command: "call execute-sql {}" },
      },
    });
    const decision = await stub.invokeRequest(
      "item/commandExecution/requestApproval",
      {
        itemId: "m1",
        command: 'Allow the posthog MCP server to run tool "exec"?',
      },
    );

    expect(decision).toEqual({ decision: "accept" });
    expect(permissionToolCalls).toHaveLength(1);
    expect(permissionToolCalls[0]).toMatchObject({
      toolCallId: "m1",
      kind: "other",
      rawInput: { command: "call execute-sql {}" },
      _meta: {
        posthog: {
          toolName: "mcp__posthog__exec",
          mcp: { server: "posthog", tool: "exec" },
        },
      },
    });
  });

  it("enriches the MCP elicitation approval (posthog exec) from the in-flight tool call", async () => {
    // codex gates PostHog `exec` behind a generic elicitation (serverName only, no tool/args);
    // the adapter correlates it to the in-flight mcpToolCall so the real tool + command render.
    const stub = makeStubRpc({
      initialize: {},
      "thread/start": { thread: { id: "thr_1" } },
    });
    const permissionToolCalls: Array<Record<string, unknown>> = [];
    const client = {
      sessionUpdate: async () => {},
      requestPermission: async (params: {
        toolCall: Record<string, unknown>;
      }) => {
        permissionToolCalls.push(params.toolCall);
        return { outcome: { outcome: "selected", optionId: "accept" } };
      },
      extNotification: async () => {},
    } as unknown as AgentSideConnection;
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/bundle/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    await agent.initialize(init);
    await agent.newSession({ cwd: "/repo" } as unknown as NewSessionRequest);

    stub.emit("item/started", {
      item: {
        type: "mcpToolCall",
        id: "m1",
        server: "posthog",
        tool: "exec",
        arguments: { command: "call execute-sql {}" },
      },
    });
    const decision = await stub.invokeRequest("mcpServer/elicitation/request", {
      threadId: "thr_1",
      turnId: "turn_1",
      serverName: "posthog",
      mode: "form",
      message: 'Allow the posthog MCP server to run tool "exec"?',
    });

    expect(decision).toMatchObject({ action: "accept" });
    expect(permissionToolCalls[0]).toMatchObject({
      toolCallId: "posthog:elicitation",
      rawInput: { command: "call execute-sql {}" },
      _meta: {
        posthog: {
          toolName: "mcp__posthog__exec",
          mcp: { server: "posthog", tool: "exec" },
        },
      },
    });
  });

  function makeApprovalAgent(chooseOptionId = "allow") {
    const stub = makeStubRpc({
      initialize: {},
      "thread/start": { thread: { id: "thr_1" } },
    });
    const permissionToolCalls: Array<Record<string, unknown>> = [];
    const permissionOptions: Array<
      Array<{ optionId?: string; kind?: string }>
    > = [];
    const client = {
      sessionUpdate: async () => {},
      requestPermission: async (params: {
        toolCall: Record<string, unknown>;
        options: Array<{ optionId?: string; kind?: string }>;
      }) => {
        permissionToolCalls.push(params.toolCall);
        permissionOptions.push(params.options);
        return { outcome: { outcome: "selected", optionId: chooseOptionId } };
      },
      extNotification: async () => {},
    } as unknown as AgentSideConnection;
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/bundle/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    return { agent, stub, permissionToolCalls, permissionOptions };
  }

  it("routes a non-MCP command approval to an execute permission (kind + command body)", async () => {
    // kind:"execute" + command text content makes the host render ExecutePermission (not the fallback).
    const { agent, stub, permissionToolCalls } = makeApprovalAgent();
    await agent.initialize(init);
    await agent.newSession({ cwd: "/repo" } as unknown as NewSessionRequest);

    await stub.invokeRequest("item/commandExecution/requestApproval", {
      itemId: "c1",
      command: "rm -rf build",
    });

    expect(permissionToolCalls).toHaveLength(1);
    expect(permissionToolCalls[0]).toEqual({
      toolCallId: "c1",
      title: "rm -rf build",
      kind: "execute",
      content: [
        { type: "content", content: { type: "text", text: "rm -rf build" } },
      ],
    });
  });

  it("surfaces Allow-always and echoes codex's remember decision when offered", async () => {
    const { agent, stub, permissionOptions } =
      makeApprovalAgent("allow_always");
    await agent.initialize(init);
    await agent.newSession({ cwd: "/repo" } as unknown as NewSessionRequest);

    // codex offers the command-prefix allowlist decision for this approval.
    const decision = await stub.invokeRequest(
      "item/commandExecution/requestApproval",
      {
        itemId: "c1",
        command: "pnpm test",
        available_decisions: ["approved_execpolicy_amendment", "denied"],
      },
    );

    expect(permissionOptions[0].map((o) => o.kind)).toContain("allow_always");
    // Picking it echoes codex's own decision so it applies the amendment.
    expect(decision).toEqual({ decision: "approved_execpolicy_amendment" });
  });

  it("omits Allow-always when codex offers no remember decision", async () => {
    const { agent, stub, permissionOptions } = makeApprovalAgent("allow");
    await agent.initialize(init);
    await agent.newSession({ cwd: "/repo" } as unknown as NewSessionRequest);

    const decision = await stub.invokeRequest(
      "item/commandExecution/requestApproval",
      { itemId: "c1", command: "ls" },
    );

    expect(permissionOptions[0].map((o) => o.kind)).not.toContain(
      "allow_always",
    );
    expect(permissionOptions[0].map((o) => o.optionId)).toEqual([
      "allow",
      "reject",
      "reject_with_feedback",
    ]);
    expect(decision).toEqual({ decision: "accept" });
  });

  it("reject-with-feedback declines and steers the user's guidance into the running turn", async () => {
    const stub = makeStubRpc({
      initialize: {},
      "thread/start": { thread: { id: "thr_1" } },
      "turn/start": { turn: { id: "turn_1" } },
      // codex rotates the turn id on steer.
      "turn/steer": { turnId: "turn_2" },
    });
    const offeredOptions: Array<Array<{ optionId?: string; kind?: string }>> =
      [];
    const client = {
      sessionUpdate: async () => {},
      requestPermission: async (params: {
        options: Array<{ optionId?: string; kind?: string }>;
      }) => {
        offeredOptions.push(params.options);
        return {
          outcome: { outcome: "selected", optionId: "reject_with_feedback" },
          _meta: { customInput: "use the SDK instead of shelling out" },
        };
      },
      extNotification: async () => {},
    } as unknown as AgentSideConnection;
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    await agent.initialize(init);
    await agent.newSession({ cwd: "/repo" } as unknown as NewSessionRequest);
    // Start a turn so there's a live turnId for the steer to target.
    const done = agent.prompt({
      sessionId: "thr_1",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);
    stub.emit("turn/started", { turn: { id: "turn_1" } });

    // codex asks to run a command mid-turn; user rejects with guidance.
    const decision = await stub.invokeRequest(
      "item/commandExecution/requestApproval",
      { itemId: "c1", command: "rm -rf build" },
    );

    expect(decision).toEqual({ decision: "decline" });
    const feedbackOpt = offeredOptions[0].find(
      (o) => o.optionId === "reject_with_feedback",
    );
    expect(feedbackOpt).toBeTruthy();
    // The guidance was steered into the running turn as a follow-up message.
    const steer = stub.requests.find((r) => r.method === "turn/steer");
    expect((steer?.params as { expectedTurnId?: string })?.expectedTurnId).toBe(
      "turn_1",
    );

    // The rotated turn id from the steer response was adopted: a second
    // rejection targets turn_2, not the dead turn_1.
    await new Promise((r) => setImmediate(r));
    await stub.invokeRequest("item/commandExecution/requestApproval", {
      itemId: "c2",
      command: "rm -rf dist",
    });
    const steers = stub.requests.filter((r) => r.method === "turn/steer");
    expect(
      (steers[1]?.params as { expectedTurnId?: string })?.expectedTurnId,
    ).toBe("turn_2");

    stub.emit("turn/completed", { turn: { status: "completed" } });
    await done;
  });

  it("routes a non-MCP file-change approval to an edit permission (kind + diff + locations)", async () => {
    const { agent, stub, permissionToolCalls } = makeApprovalAgent();
    await agent.initialize(init);
    await agent.newSession({ cwd: "/repo" } as unknown as NewSessionRequest);

    await stub.invokeRequest("item/fileChange/requestApproval", {
      itemId: "f1",
      changes: [{ path: "src/a.ts", diff: "@@ -1 +1 @@\n-old\n+new\n" }],
    });

    expect(permissionToolCalls).toHaveLength(1);
    const tc = permissionToolCalls[0];
    expect(tc.kind).toBe("edit");
    expect(tc.locations).toEqual([{ path: "src/a.ts" }]);
    // A diff content block so the host's EditPermission renders the change.
    expect(Array.isArray(tc.content)).toBe(true);
    expect((tc.content as Array<{ type?: string }>)[0]?.type).toBe("diff");
  });

  it("passes outputSchema to turn/start and fires onStructuredOutput", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const outputs: Array<Record<string, unknown>> = [];
    const schema = {
      type: "object",
      properties: { repo: { type: "string" } },
      required: ["repo"],
    };
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
      onStructuredOutput: async (o) => {
        outputs.push(o);
      },
    });

    await agent.newSession({
      cwd: "/r",
      _meta: { jsonSchema: schema },
    } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "pick a repo" }],
    } as unknown as PromptRequest);

    // The schema-constrained final message is pure JSON.
    stub.emit("item/completed", {
      item: {
        type: "agentMessage",
        id: "a1",
        text: '{"repo":"posthog/posthog"}',
      },
    });
    stub.emit("turn/completed", { turn: { status: "completed" } });
    await done;

    const turnStart = stub.requests.find((r) => r.method === "turn/start");
    expect(turnStart?.params).toMatchObject({ outputSchema: schema });
    expect(outputs).toEqual([{ repo: "posthog/posthog" }]);
  });

  it("injects task instructions and mcp_servers into thread/start", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: {
        binaryPath: "/x/codex",
        developerInstructions: "Codex guidance.",
      },
      rpcFactory: stub.factory,
    });

    await agent.newSession({
      cwd: "/r",
      _meta: { systemPrompt: "You are a repo selector." },
      mcpServers: [
        {
          name: "posthog",
          command: "node",
          args: ["server.js"],
          env: [{ name: "TOKEN", value: "abc" }],
        },
      ],
    } as unknown as NewSessionRequest);

    const threadStart = stub.requests.find((r) => r.method === "thread/start");
    expect(threadStart?.params).toMatchObject({
      developerInstructions: "Codex guidance.\n\nYou are a repo selector.",
      config: {
        mcp_servers: {
          posthog: {
            command: "node",
            args: ["server.js"],
            env: { TOKEN: "abc" },
          },
        },
      },
    });
  });

  it("flattens the host's {append} systemPrompt and dedupes it against developerInstructions", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: {
        binaryPath: "/x/codex",
        // The host pre-flattens into developerInstructions AND sends the raw {append} form.
        developerInstructions: "Be a careful engineer.",
      },
      rpcFactory: stub.factory,
    });

    await agent.newSession({
      cwd: "/r",
      _meta: { systemPrompt: { append: "Be a careful engineer." } },
    } as unknown as NewSessionRequest);

    const threadStart = stub.requests.find((r) => r.method === "thread/start");
    // {append} is flattened (not "[object Object]") and, being identical, deduped to one copy.
    expect(
      (threadStart?.params as { developerInstructions?: string })
        .developerInstructions,
    ).toBe("Be a careful engineer.");
  });

  it("appends a distinct {append} systemPrompt to developerInstructions", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: {
        binaryPath: "/x/codex",
        developerInstructions: "Codex base guidance.",
      },
      rpcFactory: stub.factory,
    });

    await agent.newSession({
      cwd: "/r",
      _meta: { systemPrompt: { append: "Task: fix the bug." } },
    } as unknown as NewSessionRequest);

    const threadStart = stub.requests.find((r) => r.method === "thread/start");
    expect(
      (threadStart?.params as { developerInstructions?: string })
        .developerInstructions,
    ).toBe("Codex base guidance.\n\nTask: fix the bug.");
  });

  it("honors the host's initial _meta.permissionMode (read-only) in turn/start", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "turn/start": { turn: { id: "turn_1" } },
    });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });
    await agent.newSession({
      cwd: "/r",
      _meta: { permissionMode: "read-only" },
    } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);
    stub.emit("turn/completed", { turn: { status: "completed" } });
    await done;

    const turnStart = stub.requests.find((r) => r.method === "turn/start");
    // read-only maps to approvalPolicy "untrusted" (mirrors codex-acp).
    expect(
      (turnStart?.params as { approvalPolicy?: string }).approvalPolicy,
    ).toBe("untrusted");
  });

  it("falls back to auto for a non-codex initial permissionMode", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "turn/start": { turn: { id: "turn_1" } },
    });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });
    // "bypassPermissions" is a Claude mode, not a codex mode → default "auto".
    await agent.newSession({
      cwd: "/r",
      _meta: { permissionMode: "bypassPermissions" },
    } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);
    stub.emit("turn/completed", { turn: { status: "completed" } });
    await done;

    const turnStart = stub.requests.find((r) => r.method === "turn/start");
    expect(
      (turnStart?.params as { approvalPolicy?: string }).approvalPolicy,
    ).toBe("on-request");
  });

  it("applies a read-only sandboxPolicy + approvalPolicy when the picker is Plan", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "turn/start": { turn: { id: "turn_1" } },
    });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    await agent.setSessionConfigOption({
      configId: "mode",
      value: "plan",
      sessionId: "t",
    } as never);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);
    stub.emit("turn/completed", { turn: { status: "completed" } });
    await done;

    const turnStart = stub.requests.find((r) => r.method === "turn/start");
    const params = turnStart?.params as {
      sandboxPolicy?: unknown;
      approvalPolicy?: string;
      collaborationMode?: unknown;
    };
    // Plan engages codex's plan collaboration AND blocks edits via a read-only sandbox.
    expect(params.collaborationMode).toEqual({
      mode: "plan",
      settings: { model: "gpt-5.5" },
    });
    expect(params.sandboxPolicy).toEqual({
      type: "readOnly",
      networkAccess: true,
    });
    expect(params.approvalPolicy).toBe("on-request");
  });

  it("omits sandboxPolicy for an editing preset (auto) so the spawned full-access stays", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "turn/start": { turn: { id: "turn_1" } },
    });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    // Default mode is "auto" → editing allowed, no sandbox override.
    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);
    stub.emit("turn/completed", { turn: { status: "completed" } });
    await done;

    const turnStart = stub.requests.find((r) => r.method === "turn/start");
    const params = turnStart?.params as {
      sandboxPolicy?: unknown;
      collaborationMode?: unknown;
    };
    expect(params.sandboxPolicy).toBeUndefined();
    // Default collaboration is pushed every turn so switching back from Plan reverts.
    expect(params.collaborationMode).toEqual({
      mode: "default",
      settings: { model: "gpt-5.5" },
    });
  });

  it("returns mode + model + thought_level configOptions and emits config_option_update", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "model/list": {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "high" },
            ],
          },
        ],
      },
    });
    const { client, sessionUpdates } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    const session = await agent.newSession({
      cwd: "/r",
    } as unknown as NewSessionRequest);
    const opts = (session.configOptions ?? []) as any[];
    expect(opts.map((o) => o.category)).toEqual([
      "mode",
      "model",
      "thought_level",
    ]);
    expect(
      opts.find((o) => o.category === "mode").options.map((x: any) => x.value),
    ).toEqual(["plan", "read-only", "auto", "full-access"]);
    expect(
      opts
        .find((o) => o.category === "thought_level")
        .options.map((x: any) => x.value),
    ).toEqual(["low", "high"]);
    expect(
      sessionUpdates.some(
        (u: any) => u.update?.sessionUpdate === "config_option_update",
      ),
    ).toBe(true);
  });

  it("drops Claude models from the picker and falls back to the codex effort map when model/list reports none", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "model/list": {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            hidden: false,
            // The PostHog gateway populates no efforts (defaultReasoningEffort:"none").
            supportedReasoningEfforts: [],
          },
          {
            // The gateway also serves Claude models — they must not leak into the picker.
            id: "claude-opus-4-8",
            model: "claude-opus-4-8",
            hidden: false,
            supportedReasoningEfforts: [],
          },
        ],
      },
    });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    const session = await agent.newSession({
      cwd: "/r",
    } as unknown as NewSessionRequest);
    const opts = (session.configOptions ?? []) as any[];

    expect(
      opts.find((o) => o.category === "model").options.map((x: any) => x.value),
    ).toEqual(["gpt-5.5"]);
    // No live efforts → shared codex map, which exposes xhigh for the gpt-5.5 family.
    expect(
      opts
        .find((o) => o.category === "thought_level")
        .options.map((x: any) => x.value),
    ).toContain("xhigh");
  });

  it("setSessionConfigOption switches the model and re-emits config", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const res = await agent.setSessionConfigOption({
      configId: "model",
      value: "gpt-6",
      sessionId: "t",
    } as any);
    const modelOpt = (res.configOptions as any[]).find(
      (o) => o.category === "model",
    );
    expect(modelOpt.currentValue).toBe("gpt-6");
  });

  it("sends activePermissionProfile :read-only on turn/start in read-only mode", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });
    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    await agent.setSessionConfigOption({
      configId: "mode",
      value: "read-only",
      sessionId: "t",
    } as any);

    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "look around" }],
    } as unknown as PromptRequest);
    stub.emit("turn/completed", { turn: { status: "completed" } });
    await done;

    // codex 0.140.0 enforces the sandbox via the named profile, so read-only MUST send it alongside sandboxPolicy.
    const turnStart = stub.requests.find((r) => r.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      activePermissionProfile: { extends: ":read-only" },
      sandboxPolicy: { type: "readOnly" },
    });
  });

  it("resumeSession resumes the existing thread and returns configOptions", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t1" } },
      "thread/resume": { thread: { id: "t1" } },
    });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const res = await agent.resumeSession({
      sessionId: "t1",
      cwd: "/r",
      mcpServers: [],
    } as any);
    const resumeReq = stub.requests.find((r) => r.method === "thread/resume");
    expect(resumeReq?.params).toMatchObject({ threadId: "t1" });
    expect((res.configOptions as any[]).length).toBeGreaterThan(0);
  });

  it("listSessions maps thread/list to ACP sessions", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "thread/list": {
        data: [
          { id: "t1", cwd: "/r", name: "Task 1" },
          { id: "t2", cwd: "/r2" },
        ],
      },
    });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const res = await agent.listSessions({ cwd: "/r" } as any);
    expect(res.sessions).toEqual([
      { sessionId: "t1", cwd: "/r", title: "Task 1" },
      { sessionId: "t2", cwd: "/r2" },
    ]);
  });

  it("forkSession forks and returns a session id", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t1" } },
      "thread/fork": { thread: { id: "t2" } },
    });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const res = await agent.unstable_forkSession({
      sessionId: "t1",
      cwd: "/r",
      mcpServers: [],
    } as any);
    expect(res.sessionId).toBe("t2");
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
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);
    stub.emit("turn/completed", { turn: { status: "failed" } });

    expect((await done).stopReason).toBe("refusal");
  });

  it("maps an interrupted turn to cancelled", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);
    stub.emit("turn/completed", { turn: { status: "interrupted" } });

    expect((await done).stopReason).toBe("cancelled");
  });

  it("closeSession resolves an in-flight prompt as cancelled instead of hanging", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);

    await agent.closeSession();

    expect((await done).stopReason).toBe("cancelled");
    // The session is fully torn down: a late turn/completed is a no-op.
    stub.emit("turn/completed", { turn: { status: "completed" } });
  });

  it("finalizes the turn on a non-retried error notification", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);
    // willRetry:false must resolve the turn rather than hang until stream close.
    stub.emit("error", { willRetry: false, error: { message: "boom" } });

    expect((await done).stopReason).toBe("refusal");
  });

  it("ends the turn without turn/start when no prompt block is usable", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const res = await agent.prompt({
      sessionId: "t",
      prompt: [{ type: "audio", data: "AAAA", mimeType: "audio/wav" }],
    } as unknown as PromptRequest);

    expect(res.stopReason).toBe("end_turn");
    expect(stub.requests.some((r) => r.method === "turn/start")).toBe(false);
  });

  it("finalizes a turn once when error and turn/completed both arrive", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const outputs: Array<Record<string, unknown>> = [];
    const { client, extNotifications } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
      onStructuredOutput: async (o) => {
        outputs.push(o);
      },
    });
    const schema = {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    };

    await agent.newSession({
      cwd: "/r",
      _meta: { jsonSchema: schema, taskRunId: "run_x" },
    } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);

    stub.emit("item/completed", {
      item: { type: "agentMessage", id: "a1", text: '{"ok":true}' },
    });
    // error + turn/completed for one turn must not double-fire turn_complete (idempotent).
    stub.emit("error", { willRetry: false, error: { message: "boom" } });
    stub.emit("turn/completed", { turn: { status: "failed" } });
    await done;

    // Structured output is gated on a clean end_turn: a refused turn records nothing.
    expect(outputs).toEqual([]);
    expect(
      extNotifications.filter((n) => n.method === "_posthog/turn_complete")
        .length,
    ).toBe(1);
  });

  it("routes command approvals to the host and maps allow to a decision envelope", async () => {
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

    expect(decision).toEqual({ decision: "accept" });
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

  it("interrupts by sending turn/interrupt with the live threadId + turnId", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);
    // turn/started carries the live turnId the server REQUIRES on turn/interrupt (else -32600).
    stub.emit("turn/started", { turn: { id: "turn_1" } });

    await agent.cancel({ sessionId: "t" });

    expect((await done).stopReason).toBe("cancelled");
    const req = stub.requests.find((r) => r.method === "turn/interrupt");
    expect(req?.params).toEqual({ threadId: "t", turnId: "turn_1" });
  });

  it("a cancelled turn's late completion does not cancel the follow-up turn", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "turn/start": { turn: { id: "turn_1" } },
    });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });
    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);

    // Turn 1, then cancel it (records turn_1 as interrupted).
    const first = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);
    stub.emit("turn/started", { turn: { id: "turn_1" } });
    await agent.cancel({ sessionId: "t" });
    expect((await first).stopReason).toBe("cancelled");

    // Follow-up turn 2.
    const second = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "again" }],
    } as unknown as PromptRequest);
    stub.emit("turn/started", { turn: { id: "turn_2" } });
    // The cancelled turn's late completion arrives during turn 2 — it must be ignored.
    stub.emit("turn/completed", {
      turn: { id: "turn_1", status: "interrupted" },
    });
    stub.emit("turn/completed", {
      turn: { id: "turn_2", status: "completed" },
    });
    expect((await second).stopReason).toBe("end_turn");
  });

  it("emits _posthog/turn_complete with cancelled on interrupt (matches codex-acp)", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client, extNotifications } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({
      cwd: "/r",
      _meta: { taskRunId: "run_c" },
    } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);
    // Emit turn/started so the interrupt actually reaches the binary (else false-green on local finalize).
    stub.emit("turn/started", { turn: { id: "turn_1" } });
    await agent.cancel({ sessionId: "t" });

    expect((await done).stopReason).toBe("cancelled");
    // The interrupt RPC was genuinely sent (not just locally finalized)...
    expect(
      stub.requests.find((r) => r.method === "turn/interrupt")?.params,
    ).toEqual({ threadId: "t", turnId: "turn_1" });
    // ...and a cancelled turn still emits the cloud idle signal, exactly once.
    const tcs = extNotifications.filter(
      (n) => n.method === "_posthog/turn_complete",
    );
    expect(tcs).toHaveLength(1);
    expect((tcs[0].params as { stopReason?: string }).stopReason).toBe(
      "cancelled",
    );
  });

  it("skips turn/interrupt (but still finalizes cancelled) when no turn/started arrived", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);
    // No turn/started → no turnId: interrupt() must skip the RPC (else -32600) and still finalize.
    await agent.cancel({ sessionId: "t" });

    expect((await done).stopReason).toBe("cancelled");
    expect(stub.requests.some((r) => r.method === "turn/interrupt")).toBe(
      false,
    );
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
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);

    await expect(
      agent.prompt({
        sessionId: "t",
        prompt: [{ type: "text", text: "again" }],
      } as unknown as PromptRequest),
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
    ).toEqual({ decision: "decline" });
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
    ).toEqual({ decision: "cancel" });
  });

  it("folds a mid-turn prompt into the running turn via turn/steer", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "turn/start": { turn: { id: "turn_1" } },
    });
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

    // The active turn id arrives via turn/started; it's the steer precondition.
    stub.emit("turn/started", { threadId: "t", turn: { id: "turn_1" } });

    const second = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "more context" }],
    } as unknown as PromptRequest);

    // The single turn/completed resolves both the original and the folded prompt.
    stub.emit("turn/completed", { turn: { status: "completed" } });
    expect((await first).stopReason).toBe("end_turn");
    expect((await second).stopReason).toBe("end_turn");

    const steer = stub.requests.find((r) => r.method === "turn/steer");
    expect(steer?.params).toMatchObject({
      threadId: "t",
      expectedTurnId: "turn_1",
      input: [{ type: "text", text: "more context" }],
    });
    // Only one turn/start — the second prompt steered rather than starting anew.
    expect(stub.requests.filter((r) => r.method === "turn/start")).toHaveLength(
      1,
    );
  });

  it("refreshes the live turnId from each turn/steer response", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "turn/start": { turn: { id: "turn_1" } },
      "turn/steer": { turnId: "turn_2" }, // the server rotates the active turn id
    });
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
    stub.emit("turn/started", { turn: { id: "turn_1" } });

    const second = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "two" }],
    } as unknown as PromptRequest);
    // Let the first steer's rotated turnId apply before the next steer reads it.
    await new Promise((r) => setTimeout(r, 0));
    const third = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "three" }],
    } as unknown as PromptRequest);

    stub.emit("turn/completed", { turn: { status: "completed" } });
    await Promise.all([first, second, third]);

    const steers = stub.requests.filter((r) => r.method === "turn/steer");
    expect(steers).toHaveLength(2);
    expect(
      (steers[0].params as { expectedTurnId?: string }).expectedTurnId,
    ).toBe("turn_1");
    // After the first steer rotated the id, the second steer must target turn_2.
    expect(
      (steers[1].params as { expectedTurnId?: string }).expectedTurnId,
    ).toBe("turn_2");
  });

  it("omits disabled skills from available_commands_update", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "skills/list": {
        data: [
          {
            skills: [
              { name: "deploy", description: "Deploy", enabled: true },
              { name: "danger", description: "Disabled", enabled: false },
            ],
          },
        ],
      },
    });
    const { client, sessionUpdates } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });
    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);

    const cmds = (
      sessionUpdates.find(
        (u: any) => u.update?.sessionUpdate === "available_commands_update",
      ) as any
    )?.update?.availableCommands;
    expect(cmds.map((c: { name: string }) => c.name)).toEqual(["deploy"]);
  });

  it("emits _posthog/sdk_session when a taskRunId is present", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "thr_x" } } });
    const { client, extNotifications } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({
      cwd: "/r",
      _meta: { taskRunId: "run_42" },
    } as unknown as NewSessionRequest);

    expect(extNotifications).toContainEqual({
      method: "_posthog/sdk_session",
      params: { taskRunId: "run_42", sessionId: "thr_x", adapter: "codex" },
    });
  });

  it("does not emit _posthog/sdk_session without a taskRunId", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client, extNotifications } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    expect(
      extNotifications.some((n) => n.method === "_posthog/sdk_session"),
    ).toBe(false);
  });

  it("emits _posthog/turn_complete and usage breakdown on turn completion", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "turn/start": { turn: { id: "turn_1" } },
    });
    const { client, extNotifications } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({
      cwd: "/r",
      _meta: { taskRunId: "run_1", systemPrompt: "be terse" },
    } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "hi" }],
    } as unknown as PromptRequest);

    stub.emit("thread/tokenUsage/updated", {
      threadId: "t",
      turnId: "turn_1",
      tokenUsage: {
        total: {
          totalTokens: 100,
          inputTokens: 60,
          cachedInputTokens: 10,
          outputTokens: 30,
          reasoningOutputTokens: 5,
        },
        modelContextWindow: 200000,
      },
    });
    stub.emit("turn/completed", { turn: { status: "completed" } });
    await done;

    const turnComplete = extNotifications.find(
      (n) => n.method === "_posthog/turn_complete",
    );
    expect(turnComplete?.params).toMatchObject({
      sessionId: "t",
      stopReason: "end_turn",
      usage: {
        inputTokens: 60,
        outputTokens: 30,
        cachedReadTokens: 10,
        cachedWriteTokens: 0,
        totalTokens: 100,
      },
    });
    // The breakdown variant carries a per-source `breakdown`, not `used`.
    const breakdown = extNotifications.find(
      (n) =>
        n.method === "_posthog/usage_update" &&
        (n.params as { breakdown?: unknown }).breakdown,
    );
    expect(breakdown).toBeDefined();
  });

  it("context-usage indicator reports the latest turn, not the cumulative thread total", async () => {
    // The window-occupancy indicator must track `last`, not the cumulative `total`
    // (which over-reports the window as filling from accumulation alone).
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client, extNotifications } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });
    await agent.newSession({
      cwd: "/r",
      _meta: { taskRunId: "run_ctx" },
    } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "hi" }],
    } as unknown as PromptRequest);

    stub.emit("thread/tokenUsage/updated", {
      tokenUsage: {
        total: {
          totalTokens: 433289,
          inputTokens: 432636,
          cachedInputTokens: 76928,
          outputTokens: 595,
        },
        last: {
          totalTokens: 189075,
          inputTokens: 111552,
          cachedInputTokens: 76928,
          outputTokens: 595,
        },
        modelContextWindow: 997500,
      },
    });
    stub.emit("turn/completed", { turn: { status: "completed" } });
    await done;

    const usageUpdate = extNotifications.find(
      (n) =>
        n.method === "_posthog/usage_update" &&
        typeof (n.params as { used?: unknown }).used === "number",
    );
    // `used` is last.totalTokens (189075), NOT total.totalTokens (433289).
    expect(usageUpdate?.params).toMatchObject({
      used: 189075,
      size: 997500,
      usage: { inputTokens: 111552, totalTokens: 189075 },
    });
  });

  it("reports codex's per-turn `last` (not the cumulative total) in turn_complete", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client, extNotifications } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });
    await agent.newSession({
      cwd: "/r",
      _meta: { taskRunId: "run_u" },
    } as unknown as NewSessionRequest);

    // We let `last` drive the per-turn number rather than diffing the cumulative `total`.
    const t1 = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "a" }],
    } as unknown as PromptRequest);
    stub.emit("thread/tokenUsage/updated", {
      tokenUsage: {
        total: { inputTokens: 100, outputTokens: 50 },
        last: { inputTokens: 100, outputTokens: 50 },
      },
    });
    stub.emit("turn/completed", { turn: { status: "completed" } });
    await t1;

    const t2 = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "b" }],
    } as unknown as PromptRequest);
    stub.emit("thread/tokenUsage/updated", {
      tokenUsage: {
        total: { inputTokens: 250, outputTokens: 120 },
        last: { inputTokens: 150, outputTokens: 70 },
      },
    });
    stub.emit("turn/completed", { turn: { status: "completed" } });
    await t2;

    const tcs = extNotifications.filter(
      (n) => n.method === "_posthog/turn_complete",
    );
    expect(tcs).toHaveLength(2);
    expect(
      (tcs[0].params as { usage: Record<string, number> }).usage,
    ).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
    });
    // Turn 2 is codex's `last` (150/70) — NOT the cumulative total (250/120).
    expect(
      (tcs[1].params as { usage: Record<string, number> }).usage,
    ).toMatchObject({
      inputTokens: 150,
      outputTokens: 70,
    });
  });

  it("signals compaction start (_posthog/status) when a contextCompaction item begins", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client, extNotifications } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });
    await agent.newSession({
      cwd: "/r",
      _meta: {},
    } as unknown as NewSessionRequest);

    stub.emit("item/started", {
      item: { type: "contextCompaction", id: "c1" },
    });

    // Mirrors the Claude adapter — the host sets isCompacting (gates steer/queue).
    const status = extNotifications.find((n) => n.method === "_posthog/status");
    expect(status?.params).toMatchObject({
      sessionId: "t",
      status: "compacting",
    });
  });

  it("emits compact_boundary + a transcript marker when the compaction item completes", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client, extNotifications, sessionUpdates } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });
    await agent.newSession({
      cwd: "/r",
      _meta: {},
    } as unknown as NewSessionRequest);

    // The compaction item brackets it: started → in progress, completed → boundary.
    stub.emit("item/started", {
      item: { type: "contextCompaction", id: "c1" },
    });
    stub.emit("item/completed", {
      item: { type: "contextCompaction", id: "c1", summary: "…" },
    });

    // compact_boundary clears isCompacting + drains the host queue.
    expect(
      extNotifications.find((n) => n.method === "_posthog/compact_boundary")
        ?.params,
    ).toMatchObject({ sessionId: "t" });
    // ...and a user-visible marker lands in the transcript.
    expect(sessionUpdates).toContainEqual({
      sessionId: "t",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "\n\nContext compacted." },
      },
    });
    // Exactly one boundary — the dedupe flag prevents a double-emit.
    expect(
      extNotifications.filter((n) => n.method === "_posthog/compact_boundary"),
    ).toHaveLength(1);
  });

  it("still emits compact_boundary when the turn dies mid-compaction (no stuck isCompacting)", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client, extNotifications } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });
    await agent.newSession({
      cwd: "/r",
      _meta: {},
    } as unknown as NewSessionRequest);

    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "go" }],
    } as unknown as PromptRequest);
    // A fatal error ends the turn before item/completed; the finalize-time recovery still fires the boundary.
    stub.emit("item/started", {
      item: { type: "contextCompaction", id: "c1" },
    });
    stub.emit("error", { willRetry: false, error: { message: "boom" } });
    await done;

    expect(
      extNotifications.find((n) => n.method === "_posthog/compact_boundary")
        ?.params,
    ).toMatchObject({ sessionId: "t" });
  });

  it("loadSession resumes the thread and returns configOptions", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t1" } },
      "thread/resume": { thread: { id: "t1" } },
    });
    const { client, extNotifications } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);

    const res = await agent.loadSession({
      sessionId: "t1",
      cwd: "/r",
      mcpServers: [],
      _meta: { taskRunId: "run_load" },
    } as unknown as Parameters<typeof agent.loadSession>[0]);

    const resumeReq = stub.requests.find((r) => r.method === "thread/resume");
    expect(resumeReq?.params).toMatchObject({ threadId: "t1" });
    expect((res.configOptions as any[]).length).toBeGreaterThan(0);
    // loadSession replays sdk_session so post-reload task tracking still works.
    expect(extNotifications).toContainEqual({
      method: "_posthog/sdk_session",
      params: { taskRunId: "run_load", sessionId: "t1", adapter: "codex" },
    });
  });

  it("loadSession replays the resumed thread's persisted transcript", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t1" } },
      "thread/resume": {
        thread: {
          id: "t1",
          turns: [
            {
              items: [
                {
                  type: "userMessage",
                  id: "u1",
                  content: [{ type: "text", text: "fix the bug" }],
                },
                {
                  type: "commandExecution",
                  id: "c1",
                  command: "ls",
                  status: "completed",
                },
                { type: "agentMessage", id: "a1", text: "fixed it" },
              ],
            },
          ],
        },
      },
    });
    const { client, sessionUpdates } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      model: "gpt-5.5",
      rpcFactory: stub.factory,
    });
    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);

    await agent.loadSession({
      sessionId: "t1",
      cwd: "/r",
      mcpServers: [],
    } as unknown as Parameters<typeof agent.loadSession>[0]);

    const kinds = (sessionUpdates as any[]).map((u) => u.update?.sessionUpdate);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "user_message_chunk",
        "tool_call",
        "agent_message_chunk",
      ]),
    );
    expect(sessionUpdates).toContainEqual({
      sessionId: "t1",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "fix the bug" },
      },
    });
  });

  it("forwards additionalDirectories to thread/start as writable_roots", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({
      cwd: "/repo",
      additionalDirectories: ["/repo/pkg-a", "/repo/pkg-b"],
    } as unknown as NewSessionRequest);

    const threadStart = stub.requests.find((r) => r.method === "thread/start");
    expect(threadStart?.params).toMatchObject({
      config: {
        sandbox_workspace_write: {
          writable_roots: ["/repo/pkg-a", "/repo/pkg-b"],
        },
      },
    });
  });

  it("carries an image block through to turn/start input", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "turn/start": { turn: { id: "turn_1" } },
    });
    const { client } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [
        { type: "text", text: "look at this" },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      ],
    } as unknown as PromptRequest);
    stub.emit("turn/completed", { turn: { status: "completed" } });
    await done;

    const turnStart = stub.requests.find((r) => r.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      input: [
        { type: "text", text: "look at this", text_elements: [] },
        { type: "image", url: "data:image/png;base64,aGVsbG8=" },
      ],
    });
  });

  it("prepends _meta.prContext to the forwarded turn input but not the echo", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "turn/start": { turn: { id: "turn_1" } },
    });
    const { client, sessionUpdates } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const done = agent.prompt({
      sessionId: "t",
      prompt: [{ type: "text", text: "fix the bug" }],
      _meta: { prContext: "PR #123 is open; review before editing." },
    } as unknown as PromptRequest);
    stub.emit("turn/completed", { turn: { status: "completed" } });
    await done;

    // prContext is prepended to the FORWARDED prompt (parity with claude + codex-acp).
    const turnStart = stub.requests.find((r) => r.method === "turn/start");
    expect(
      (turnStart?.params as { input: Array<{ text?: string }> }).input,
    ).toEqual([
      {
        type: "text",
        text: "PR #123 is open; review before editing.",
        text_elements: [],
      },
      { type: "text", text: "fix the bug", text_elements: [] },
    ]);
    // The echoed user turn shows only the real message (no prContext prefix).
    const echoes = (sessionUpdates as any[]).filter(
      (u) => u.update?.sessionUpdate === "user_message_chunk",
    );
    expect(echoes).toEqual([
      {
        sessionId: "t",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "fix the bug" },
        },
      },
    ]);
  });

  it("echoes an image-only user turn as a user_message_chunk", async () => {
    const stub = makeStubRpc({
      "thread/start": { thread: { id: "t" } },
      "turn/start": { turn: { id: "turn_1" } },
    });
    const { client, sessionUpdates } = makeFakeClient();
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
    const done = agent.prompt({
      sessionId: "t",
      prompt: [image],
    } as unknown as PromptRequest);
    stub.emit("turn/completed", { turn: { status: "completed" } });
    await done;

    expect(sessionUpdates).toContainEqual({
      sessionId: "t",
      update: { sessionUpdate: "user_message_chunk", content: image },
    });
  });

  it("routes item/tool/requestUserInput through the richer-approval handler", async () => {
    const stub = makeStubRpc({ "thread/start": { thread: { id: "t" } } });
    const { client } = makeFakeClient({
      outcome: "selected",
      optionId: "option_0",
    });
    const agent = new CodexAppServerAgent(client, {
      processOptions: { binaryPath: "/x/codex" },
      rpcFactory: stub.factory,
    });

    await agent.newSession({ cwd: "/r" } as unknown as NewSessionRequest);
    const response = await stub.invokeRequest("item/tool/requestUserInput", {
      threadId: "t",
      turnId: "turn_1",
      itemId: "i1",
      questions: [
        {
          id: "q1",
          header: "Pick",
          question: "Which one?",
          isOther: false,
          isSecret: false,
          options: [
            { label: "A", description: "" },
            { label: "B", description: "" },
          ],
        },
      ],
      autoResolutionMs: null,
    });

    // The richer handler returns a typed { answers } object, not a decision string.
    expect(response).toEqual({ answers: { q1: { answers: ["A"] } } });
  });
});
