import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POSTHOG_METHODS } from "../../acp-extensions";
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
  supportedCommands: ReturnType<typeof vi.fn>;
  initializationResult: ReturnType<typeof vi.fn>;
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
    supportedCommands: vi.fn().mockResolvedValue([]),
    initializationResult: vi.fn().mockImplementation(() => nextInitPromise),
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

const fetchMcpToolMetadataMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./mcp/tool-metadata", () => ({
  fetchMcpToolMetadata: fetchMcpToolMetadataMock,
  getConnectedMcpServerNames: vi.fn().mockReturnValue([]),
}));

// Import after the mocks so ClaudeAcpAgent resolves the mocked SDK
const { ClaudeAcpAgent } = await import("./claude-agent");
type Agent = InstanceType<typeof ClaudeAcpAgent>;

function makeAgent(): Agent {
  const client = {
    sessionUpdate: vi.fn().mockResolvedValue(undefined),
    extNotification: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentSideConnection;
  return new ClaudeAcpAgent(client);
}

function installFakeSession(
  agent: Agent,
  sessionId: string,
  overrides: Partial<{ modelId: string }> = {},
) {
  const oldQuery = makeQueryHandle();
  const input = new Pushable();
  const endSpy = vi.spyOn(input, "end");
  const abortController = new AbortController();

  const session = {
    query: oldQuery,
    queryOptions: {
      sessionId,
      cwd: "/tmp/repo",
      model: "claude-sonnet-4-6",
      mcpServers: { posthog: { type: "http", url: "https://old" } },
      abortController,
    },
    input,
    cancelled: false,
    settingsManager: { dispose: vi.fn() },
    permissionMode: "default",
    abortController,
    accumulatedUsage: {
      inputTokens: 42,
      outputTokens: 17,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
    },
    sessionResources: new Set(),
    configOptions: [],
    promptRunning: false,
    pendingMessages: new Map(),
    nextPendingOrder: 0,
    cwd: "/tmp/repo",
    notificationHistory: [{ foo: "bar" }],
    taskRunId: "run-1",
    modelId: overrides.modelId,
  } as unknown as Parameters<typeof Object.assign>[0];

  (agent as unknown as { session: unknown }).session = session;
  (agent as unknown as { sessionId: string }).sessionId = sessionId;

  return { session, oldQuery, endSpy, abortController };
}

const freshMcpServers = [
  {
    name: "posthog",
    type: "http" as const,
    url: "https://fresh",
    headers: [{ name: "x-foo", value: "bar" }],
  },
];

describe("ClaudeAcpAgent.extMethod refresh_session", () => {
  beforeEach(() => {
    lastQueryCall.options = undefined;
    createdQueries.length = 0;
    nextInitPromise = Promise.resolve({
      result: "success",
      commands: [],
      models: [],
    });
    fetchMcpToolMetadataMock.mockClear();
  });

  it("returns methodNotFound for unknown extension methods", async () => {
    const agent = makeAgent();
    await expect(agent.extMethod("_posthog/nope", {})).rejects.toThrow(
      /Method not found/i,
    );
  });

  it("rejects when payload has no refreshable fields", async () => {
    const agent = makeAgent();
    installFakeSession(agent, "s-empty");

    await expect(
      agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {}),
    ).rejects.toThrow(/requires at least one refreshable field/);
  });

  it("rejects when mcpServers is not an array", async () => {
    const agent = makeAgent();
    installFakeSession(agent, "s-malformed");

    await expect(
      agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {
        mcpServers: "not-an-array",
      }),
    ).rejects.toThrow(/mcpServers must be an array/);
  });

  it("rejects refresh while a prompt is in flight", async () => {
    const agent = makeAgent();
    const { session } = installFakeSession(agent, "s-1");
    (session as unknown as { promptRunning: boolean }).promptRunning = true;

    await expect(
      agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {
        mcpServers: freshMcpServers,
      }),
    ).rejects.toThrow(/prompt turn is in flight/);
  });

  it("rejects when session model does not support MCP injection", async () => {
    const agent = makeAgent();
    installFakeSession(agent, "s-haiku", { modelId: "claude-haiku-4-5" });

    await expect(
      agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {
        mcpServers: freshMcpServers,
      }),
    ).rejects.toThrow(/does not support MCP injection/);
  });

  it("throws when initialization of the new query times out", async () => {
    vi.useFakeTimers();
    try {
      const agent = makeAgent();
      installFakeSession(agent, "s-timeout");
      // Never resolves — withTimeout must win the race.
      nextInitPromise = new Promise<InitResult>(() => {});

      const promise = agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {
        mcpServers: freshMcpServers,
      });
      // Drop the rejection on the floor so an unhandled-rejection warning
      // doesn't race the assertion below.
      promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(30_001);

      await expect(promise).rejects.toThrow(
        /Session refresh timed out for s-timeout/,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("swaps query/input/options and preserves session state", async () => {
    const agent = makeAgent();
    const { session, oldQuery, endSpy } = installFakeSession(agent, "s-2");

    const result = await agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {
      mcpServers: freshMcpServers,
    });

    expect(result).toEqual({ refreshed: true });
    expect(oldQuery.interrupt).toHaveBeenCalledTimes(1);
    expect(endSpy).toHaveBeenCalledTimes(1);

    // New query was built with resume identity (not sessionId) and new servers
    expect(lastQueryCall.options).toMatchObject({
      resume: "s-2",
      forkSession: false,
      mcpServers: {
        posthog: {
          type: "http",
          url: "https://fresh",
          headers: { "x-foo": "bar" },
        },
      },
    });
    expect(lastQueryCall.options?.sessionId).toBeUndefined();

    // Session fields swapped to the new instances
    const updated = session as unknown as {
      query: SdkQueryHandle;
      input: unknown;
      queryOptions: Record<string, unknown>;
      accumulatedUsage: { inputTokens: number };
      notificationHistory: unknown[];
    };
    expect(updated.query).toBe(createdQueries[0]);
    expect(updated.query).not.toBe(oldQuery);
    expect(updated.input).toBeInstanceOf(Pushable);
    expect(updated.queryOptions).toBe(lastQueryCall.options);

    // Preserves session-level state (usage, notification history)
    expect(updated.accumulatedUsage.inputTokens).toBe(42);
    expect(updated.notificationHistory).toEqual([{ foo: "bar" }]);
  });

  it("aborts the old controller and allocates a fresh one for the new query", async () => {
    const agent = makeAgent();
    const { session, abortController: oldController } = installFakeSession(
      agent,
      "s-abort",
    );

    await agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {
      mcpServers: freshMcpServers,
    });

    expect(oldController.signal.aborted).toBe(true);

    const updated = session as unknown as {
      abortController: AbortController;
      queryOptions: { abortController: AbortController };
    };
    expect(updated.abortController).not.toBe(oldController);
    expect(updated.abortController.signal.aborted).toBe(false);
    expect(updated.queryOptions.abortController).toBe(updated.abortController);
    expect(lastQueryCall.options?.abortController).toBe(
      updated.abortController,
    );
  });

  it("recovers when interrupting the old query throws Operation aborted", async () => {
    const agent = makeAgent();
    const { session, oldQuery, endSpy } = installFakeSession(
      agent,
      "s-interrupt-throws",
    );
    oldQuery.interrupt.mockRejectedValue(new Error("Operation aborted"));

    const result = await agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {
      mcpServers: freshMcpServers,
    });

    expect(result).toEqual({ refreshed: true });
    expect(endSpy).toHaveBeenCalledTimes(1);
    const updated = session as unknown as {
      query: SdkQueryHandle;
      abortController: AbortController;
    };
    expect(updated.query).toBe(createdQueries[0]);
    expect(updated.query).not.toBe(oldQuery);
    expect(updated.abortController.signal.aborted).toBe(false);
  });

  it("re-fetches MCP tool metadata for the new query", async () => {
    const agent = makeAgent();
    installFakeSession(agent, "s-metadata");

    await agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {
      mcpServers: freshMcpServers,
    });

    expect(fetchMcpToolMetadataMock).toHaveBeenCalledTimes(1);
    expect(fetchMcpToolMetadataMock.mock.calls[0][0]).toBe(createdQueries[0]);
  });
});
