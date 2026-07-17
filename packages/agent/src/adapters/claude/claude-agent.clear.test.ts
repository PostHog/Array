import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POSTHOG_METHODS, POSTHOG_NOTIFICATIONS } from "../../acp-extensions";
import { Pushable } from "../../utils/streams";

type InitResult = {
  result: "success";
  commands?: unknown[];
  models?: unknown[];
};

type SdkQueryHandle = {
  interrupt: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  setMcpServers: ReturnType<typeof vi.fn>;
  mcpServerStatus: ReturnType<typeof vi.fn>;
  supportedCommands: ReturnType<typeof vi.fn>;
  initializationResult: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  [Symbol.asyncIterator]: () => AsyncIterator<never>;
};

let nextInitPromise: Promise<InitResult> = Promise.resolve({
  result: "success",
  commands: [],
  models: [],
});

function makeQueryHandle(): SdkQueryHandle {
  return {
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setMcpServers: vi.fn().mockResolvedValue(undefined),
    mcpServerStatus: vi.fn().mockResolvedValue([]),
    supportedCommands: vi.fn().mockResolvedValue([]),
    initializationResult: vi.fn().mockImplementation(() => nextInitPromise),
    close: vi.fn(),
    [Symbol.asyncIterator]: async function* () {
      /* never yields */
    } as never,
  };
}

const lastQueryCall: { options?: Record<string, unknown> } = {};
const createdQueries: SdkQueryHandle[] = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn((params: { options: Record<string, unknown> }) => {
    lastQueryCall.options = params.options;
    const handle = makeQueryHandle();
    createdQueries.push(handle);
    return handle;
  }),
}));

vi.mock("./mcp/tool-metadata", () => ({
  fetchMcpToolMetadata: vi.fn().mockResolvedValue(undefined),
  getConnectedMcpServerNames: vi.fn().mockReturnValue([]),
  getCachedMcpTools: vi.fn().mockReturnValue([]),
  clearMcpToolMetadataCache: vi.fn(),
}));

// Import after the mocks so ClaudeAcpAgent resolves the mocked SDK
const { ClaudeAcpAgent } = await import("./claude-agent");
type Agent = InstanceType<typeof ClaudeAcpAgent>;

interface ClientMocks {
  sessionUpdate: ReturnType<typeof vi.fn>;
  extNotification: ReturnType<typeof vi.fn>;
}

function makeAgent(): { agent: Agent; client: ClientMocks } {
  const client: ClientMocks = {
    sessionUpdate: vi.fn().mockResolvedValue(undefined),
    extNotification: vi.fn().mockResolvedValue(undefined),
  };
  const agent = new ClaudeAcpAgent(client as unknown as AgentSideConnection);
  return { agent, client };
}

function installFakeSession(agent: Agent, sessionId: string) {
  const oldQuery = makeQueryHandle();
  const input = new Pushable();
  const endSpy = vi.spyOn(input, "end");
  const abortController = new AbortController();

  const session = {
    query: oldQuery,
    sdkSessionId: sessionId,
    queryOptions: {
      sessionId,
      cwd: "/tmp/repo",
      model: "claude-sonnet-4-6",
      mcpServers: {
        posthog: { type: "http", url: "https://posthog" },
        "posthog-code-tools": {
          type: "sdk",
          name: "posthog-code-tools",
          instance: { stale: true },
        },
      },
      abortController,
    },
    buildInProcessMcpServers: vi.fn(() => ({
      "posthog-code-tools": {
        type: "sdk" as const,
        name: "posthog-code-tools",
        instance: { fresh: true },
      },
    })),
    localToolsServerNames: ["posthog-code-tools"],
    input,
    cancelled: false,
    settingsManager: { dispose: vi.fn() },
    permissionMode: "default",
    abortController,
    accumulatedUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
    },
    sessionResources: new Set(),
    configOptions: [],
    turnQueue: [] as unknown[],
    activeTurn: null as unknown,
    pendingOrphanResults: 0,
    queryGeneration: 0,
    cwd: "/tmp/repo",
    notificationHistory: [] as unknown[],
    taskRunId: "run-1",
    lastContextWindowSize: 200_000,
    modelId: "claude-sonnet-4-6",
    taskState: new Map(),
  };

  (agent as unknown as { session: typeof session }).session = session;
  (agent as unknown as { sessionId: string }).sessionId = sessionId;

  return { session, oldQuery, endSpy, abortController };
}

function findUpdate(
  client: ClientMocks,
  sessionUpdate: string,
): Record<string, unknown> | undefined {
  const match = client.sessionUpdate.mock.calls.find(
    ([call]) =>
      (call as { update?: { sessionUpdate?: string } }).update
        ?.sessionUpdate === sessionUpdate,
  );
  return (match?.[0] as { update: Record<string, unknown> } | undefined)
    ?.update;
}

function findExtNotification(
  client: ClientMocks,
  method: string,
): Record<string, unknown> | undefined {
  const match = client.extNotification.mock.calls.find(
    ([calledMethod]) => calledMethod === method,
  );
  return match?.[1] as Record<string, unknown> | undefined;
}

describe("ClaudeAcpAgent /clear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastQueryCall.options = undefined;
    createdQueries.length = 0;
    nextInitPromise = Promise.resolve({
      result: "success",
      commands: [],
      models: [],
    });
  });

  it("swaps in a fresh SDK session and emits the clear marker", async () => {
    const { agent, client } = makeAgent();
    const { session, oldQuery, endSpy } = installFakeSession(agent, "s-1");
    session.taskState.set("task-1", { title: "old task" });

    const result = await agent.prompt({
      sessionId: "s-1",
      prompt: [{ type: "text", text: "/clear" }],
    });

    expect(result.stopReason).toBe("end_turn");

    // Old query retired, new query started fresh (no resume, new id).
    expect(oldQuery.interrupt).toHaveBeenCalledTimes(1);
    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(createdQueries).toHaveLength(1);
    expect(lastQueryCall.options?.resume).toBeUndefined();
    const newSessionId = lastQueryCall.options?.sessionId as string;
    expect(newSessionId).toBeDefined();
    expect(newSessionId).not.toBe("s-1");

    // The in-process local-tools server is rebuilt fresh.
    const servers = lastQueryCall.options?.mcpServers as Record<
      string,
      { instance?: unknown }
    >;
    expect(servers["posthog-code-tools"].instance).toEqual({ fresh: true });
    expect(servers.posthog).toMatchObject({ type: "http" });

    // ACP identity is stable; the SDK session id diverges underneath.
    expect((agent as unknown as { sessionId: string }).sessionId).toBe("s-1");
    expect(session.sdkSessionId).toBe(newSessionId);
    expect(agent.hasSession("s-1")).toBe(true);
    expect(agent.hasSession(newSessionId)).toBe(true);

    // Repoints stored session ids and marks the boundary in the log.
    expect(
      findExtNotification(client, POSTHOG_NOTIFICATIONS.SDK_SESSION),
    ).toMatchObject({
      taskRunId: "run-1",
      sessionId: newSessionId,
      adapter: "claude",
    });
    expect(
      findExtNotification(client, POSTHOG_NOTIFICATIONS.CONVERSATION_CLEARED),
    ).toMatchObject({ sessionId: newSessionId });

    // The /clear prompt is echoed to the transcript, the plan panel resets,
    // and the context indicator drops to zero.
    expect(findUpdate(client, "user_message_chunk")).toMatchObject({
      content: { type: "text", text: "/clear" },
    });
    expect(session.taskState.size).toBe(0);
    expect(findUpdate(client, "plan")).toMatchObject({ entries: [] });
    expect(findUpdate(client, "usage_update")).toMatchObject({
      used: 0,
      size: 200_000,
    });
  });

  it("emits the marker after the user message so /clear sits before the boundary", async () => {
    const { agent, client } = makeAgent();
    installFakeSession(agent, "s-order");

    let clearedAt = -1;
    let userMessageAt = -1;
    let order = 0;
    client.extNotification.mockImplementation(async (method: string) => {
      if (method === POSTHOG_NOTIFICATIONS.CONVERSATION_CLEARED) {
        clearedAt = order++;
      }
    });
    client.sessionUpdate.mockImplementation(
      async (call: { update?: { sessionUpdate?: string } }) => {
        if (call.update?.sessionUpdate === "user_message_chunk") {
          userMessageAt = order++;
        }
      },
    );

    await agent.prompt({
      sessionId: "s-order",
      prompt: [{ type: "text", text: "/clear" }],
    });

    expect(userMessageAt).toBeGreaterThanOrEqual(0);
    expect(clearedAt).toBeGreaterThan(userMessageAt);
  });

  it("refuses to clear while a turn is in flight", async () => {
    const { agent, client } = makeAgent();
    const { session, oldQuery } = installFakeSession(agent, "s-busy");
    session.activeTurn = { promptUuid: "u-1", settled: false };

    const result = await agent.prompt({
      sessionId: "s-busy",
      prompt: [{ type: "text", text: "/clear" }],
    });

    expect(result.stopReason).toBe("end_turn");
    expect(oldQuery.interrupt).not.toHaveBeenCalled();
    expect(createdQueries).toHaveLength(0);
    const chunk = findUpdate(client, "agent_message_chunk");
    expect((chunk?.content as { text?: string })?.text).toMatch(
      /Cannot clear the conversation/,
    );
    expect(
      findExtNotification(client, POSTHOG_NOTIFICATIONS.CONVERSATION_CLEARED),
    ).toBeUndefined();
  });

  it("rejects /clear after the session has ended", async () => {
    const { agent } = makeAgent();
    const { session } = installFakeSession(agent, "s-ended");
    (session as unknown as { queryClosed: boolean }).queryClosed = true;

    await expect(
      agent.prompt({
        sessionId: "s-ended",
        prompt: [{ type: "text", text: "/clear" }],
      }),
    ).rejects.toThrow(/session has ended/);
    expect(createdQueries).toHaveLength(0);
  });

  it("refreshSession resumes the post-clear SDK session", async () => {
    const { agent } = makeAgent();
    installFakeSession(agent, "s-refresh");

    await agent.prompt({
      sessionId: "s-refresh",
      prompt: [{ type: "text", text: "/clear" }],
    });
    const newSessionId = lastQueryCall.options?.sessionId as string;

    await agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {
      mcpServers: [
        { name: "posthog", type: "http" as const, url: "https://fresh" },
      ],
    });

    expect(lastQueryCall.options?.resume).toBe(newSessionId);
    expect(lastQueryCall.options?.sessionId).toBeUndefined();
  });
});
