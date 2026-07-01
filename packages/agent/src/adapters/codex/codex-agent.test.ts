import { Readable, Writable } from "node:stream";
import type {
  AgentSideConnection,
  LoadSessionResponse,
  NewSessionResponse,
} from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCodexConnection = {
  initialize: vi.fn(),
  newSession: vi.fn(),
  loadSession: vi.fn(),
  setSessionMode: vi.fn(),
  listSessions: vi.fn(),
  prompt: vi.fn(),
  setSessionConfigOption: vi.fn(),
};

const mockKill = vi.fn();

vi.mock("@agentclientprotocol/sdk", async () => {
  const actual = await vi.importActual("@agentclientprotocol/sdk");

  return {
    ...actual,
    ClientSideConnection: class {
      constructor() {
        Object.assign(this, mockCodexConnection);
      }
    },
    ndJsonStream: vi.fn(() => ({}) as object),
  };
});

vi.mock("./spawn", () => ({
  spawnCodexProcess: vi.fn(() => ({
    process: { pid: 1234 },
    stdin: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
    stdout: new Readable({
      read() {},
    }),
    kill: mockKill,
  })),
}));

vi.mock("./settings", () => ({
  CodexSettingsManager: class {
    constructor(private readonly cwd: string) {}
    initialize = vi.fn();
    dispose = vi.fn();
    getCwd = () => this.cwd;
    setCwd = vi.fn();
    getSettings = () => ({});
  },
}));

vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

import { CodexAcpAgent } from "./codex-agent";

describe("CodexAcpAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createAgent(
    overrides: Partial<AgentSideConnection> = {},
    agentOptions?: {
      onStructuredOutput?: (output: Record<string, unknown>) => Promise<void>;
    },
  ): {
    agent: CodexAcpAgent;
    client: AgentSideConnection & {
      extNotification: ReturnType<typeof vi.fn>;
      sessionUpdate: ReturnType<typeof vi.fn>;
    };
  } {
    const client = {
      extNotification: vi.fn(),
      sessionUpdate: vi.fn(),
      ...overrides,
    } as unknown as AgentSideConnection & {
      extNotification: ReturnType<typeof vi.fn>;
      sessionUpdate: ReturnType<typeof vi.fn>;
    };

    const agent = new CodexAcpAgent(client, {
      codexProcessOptions: {
        cwd: process.cwd(),
      },
      onStructuredOutput: agentOptions?.onStructuredOutput,
    });
    return { agent, client };
  }

  it("applies the requested initial mode for a new session", async () => {
    const { agent } = createAgent();
    mockCodexConnection.newSession.mockResolvedValue({
      sessionId: "session-1",
      modes: { currentModeId: "auto", availableModes: [] },
      configOptions: [],
    } satisfies Partial<NewSessionResponse>);

    const response = await agent.newSession({
      cwd: process.cwd(),
      _meta: { permissionMode: "read-only" },
    } as never);

    expect(mockCodexConnection.setSessionMode).toHaveBeenCalledWith({
      sessionId: "session-1",
      modeId: "read-only",
    });
    expect(
      (agent as unknown as { sessionState: { permissionMode: string } })
        .sessionState.permissionMode,
    ).toBe("read-only");
    expect(response.modes?.currentModeId).toBe("read-only");
  });

  it("returns the applied initial mode in config options", async () => {
    const { agent } = createAgent();
    mockCodexConnection.newSession.mockResolvedValue({
      sessionId: "session-1",
      modes: { currentModeId: "read-only", availableModes: [] },
      configOptions: [
        {
          id: "mode",
          name: "Mode",
          type: "select",
          category: "mode",
          currentValue: "read-only",
          options: [
            { value: "read-only", name: "Read Only" },
            { value: "auto", name: "Auto" },
            { value: "full-access", name: "Full Access" },
          ],
        },
      ],
    } satisfies Partial<NewSessionResponse>);

    const response = await agent.newSession({
      cwd: process.cwd(),
      _meta: { permissionMode: "full-access" },
    } as never);

    expect(mockCodexConnection.setSessionMode).toHaveBeenCalledWith({
      sessionId: "session-1",
      modeId: "full-access",
    });
    expect(response.modes?.currentModeId).toBe("full-access");
    expect(response.configOptions?.find((o) => o.id === "mode")).toEqual(
      expect.objectContaining({ currentValue: "full-access" }),
    );
    expect(
      (agent as unknown as { sessionState: { configOptions: unknown[] } })
        .sessionState.configOptions,
    ).toEqual(response.configOptions);
  });

  it("propagates taskRunId and fires SDK_SESSION when loading a cloud session", async () => {
    const { agent, client } = createAgent();
    mockCodexConnection.loadSession.mockResolvedValue({
      modes: { currentModeId: "auto", availableModes: [] },
      configOptions: [],
    } satisfies Partial<LoadSessionResponse>);

    await agent.loadSession({
      sessionId: "session-1",
      cwd: process.cwd(),
      _meta: { taskRunId: "run-1", taskId: "task-1" },
    } as never);

    expect(
      (agent as unknown as { sessionState: { taskRunId?: string } })
        .sessionState.taskRunId,
    ).toBe("run-1");
    expect(client.extNotification).toHaveBeenCalledWith(
      "_posthog/sdk_session",
      {
        taskRunId: "run-1",
        sessionId: "session-1",
        adapter: "codex",
      },
    );
  });

  it("does not emit SDK_SESSION on loadSession when taskRunId is absent", async () => {
    const { agent, client } = createAgent();
    mockCodexConnection.loadSession.mockResolvedValue({
      modes: { currentModeId: "auto", availableModes: [] },
      configOptions: [],
    } satisfies Partial<LoadSessionResponse>);

    await agent.loadSession({
      sessionId: "session-1",
      cwd: process.cwd(),
    } as never);

    expect(client.extNotification).not.toHaveBeenCalled();
  });

  it("preserves the live session mode when loading an existing session", async () => {
    const { agent } = createAgent();
    mockCodexConnection.loadSession.mockResolvedValue({
      modes: { currentModeId: "read-only", availableModes: [] },
      configOptions: [],
    } satisfies Partial<LoadSessionResponse>);

    await agent.loadSession({
      sessionId: "session-1",
      cwd: process.cwd(),
      _meta: { permissionMode: "auto" },
    } as never);

    expect(mockCodexConnection.setSessionMode).not.toHaveBeenCalled();
    expect(
      (agent as unknown as { sessionState: { permissionMode: string } })
        .sessionState.permissionMode,
    ).toBe("read-only");
  });

  it("updates local permission state when changing codex mode config", async () => {
    const { agent, client } = createAgent();
    mockCodexConnection.newSession.mockResolvedValue({
      sessionId: "session-1",
      modes: { currentModeId: "auto", availableModes: [] },
      configOptions: [],
    } satisfies Partial<NewSessionResponse>);
    mockCodexConnection.setSessionConfigOption.mockResolvedValue({
      configOptions: [
        {
          id: "mode",
          name: "Mode",
          type: "select",
          category: "mode",
          currentValue: "full-access",
          options: [
            { value: "read-only", name: "Read Only" },
            { value: "auto", name: "Auto" },
            { value: "full-access", name: "Full Access" },
          ],
        },
      ],
    });

    await agent.newSession({
      cwd: process.cwd(),
      _meta: { permissionMode: "auto" },
    } as never);
    await agent.setSessionConfigOption({
      sessionId: "session-1",
      configId: "mode",
      value: "full-access",
    });

    expect(
      (agent as unknown as { sessionState: { permissionMode: string } })
        .sessionState.permissionMode,
    ).toBe("full-access");
    expect(client.sessionUpdate).toHaveBeenCalledWith({
      sessionId: "session-1",
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: "full-access",
      },
    });
  });

  it("prepends _meta.prContext to the forwarded prompt but not to the broadcast", async () => {
    const { agent, client } = createAgent();
    mockCodexConnection.newSession.mockResolvedValue({
      sessionId: "session-1",
      modes: { currentModeId: "auto", availableModes: [] },
      configOptions: [],
    } satisfies Partial<NewSessionResponse>);
    await agent.newSession({
      cwd: process.cwd(),
    } as never);

    mockCodexConnection.prompt.mockResolvedValue({ stopReason: "end_turn" });

    await agent.prompt({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "ship the fix" }],
      _meta: { prContext: "PR #123 is open; review before editing." },
    } as never);

    // codex-acp receives the PR context prepended as a text block.
    expect(mockCodexConnection.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          { type: "text", text: "PR #123 is open; review before editing." },
          { type: "text", text: "ship the fix" },
        ],
      }),
    );
    // The broadcast shows only the real user turn — the prContext prefix
    // is internal routing and should not render as a user message.
    expect(client.sessionUpdate).toHaveBeenCalledTimes(1);
    expect(client.sessionUpdate).toHaveBeenCalledWith({
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "ship the fix" },
      },
    });
  });

  it("serializes concurrent prompts so usage accumulators are not wiped mid-turn", async () => {
    const { agent } = createAgent();
    mockCodexConnection.newSession.mockResolvedValue({
      sessionId: "session-1",
      modes: { currentModeId: "auto", availableModes: [] },
      configOptions: [],
    } satisfies Partial<NewSessionResponse>);
    await agent.newSession({
      cwd: process.cwd(),
      _meta: { taskRunId: "run-1" },
    } as never);

    const callOrder: string[] = [];
    let releaseA: () => void;
    const aStarted = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let allowAResolve: () => void = () => {};
    const aHold = new Promise<void>((resolve) => {
      allowAResolve = resolve;
    });

    mockCodexConnection.prompt.mockImplementationOnce(async () => {
      callOrder.push("A:start");
      releaseA();
      await aHold;
      callOrder.push("A:end");
      return { stopReason: "end_turn" };
    });
    mockCodexConnection.prompt.mockImplementationOnce(async () => {
      callOrder.push("B:start");
      return { stopReason: "end_turn" };
    });

    const promptA = agent.prompt({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "A" }],
    } as never);

    await aStarted;

    const promptB = agent.prompt({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "B" }],
    } as never);

    // B must not have started while A is still in-flight.
    expect(callOrder).toEqual(["A:start"]);

    allowAResolve();
    await Promise.all([promptA, promptB]);

    expect(callOrder).toEqual(["A:start", "A:end", "B:start"]);
  });

  it("does not let a failing prompt block subsequent prompts", async () => {
    const { agent } = createAgent();
    mockCodexConnection.newSession.mockResolvedValue({
      sessionId: "session-1",
      modes: { currentModeId: "auto", availableModes: [] },
      configOptions: [],
    } satisfies Partial<NewSessionResponse>);
    await agent.newSession({
      cwd: process.cwd(),
    } as never);

    mockCodexConnection.prompt.mockRejectedValueOnce(new Error("boom"));
    mockCodexConnection.prompt.mockResolvedValueOnce({
      stopReason: "end_turn",
    });

    await expect(
      agent.prompt({
        sessionId: "session-1",
        prompt: [{ type: "text", text: "A" }],
      } as never),
    ).rejects.toThrow("boom");

    await expect(
      agent.prompt({
        sessionId: "session-1",
        prompt: [{ type: "text", text: "B" }],
      } as never),
    ).resolves.toEqual({ stopReason: "end_turn" });
  });

  it.each([
    ["API Error: 429 rate_limit_error", "upstream_provider_failure"],
    ["API Error: 503 internal_error", "upstream_provider_failure"],
    ["API Error: 529 overloaded_error", "upstream_provider_failure"],
    ["ordinary failure", undefined],
  ] as const)(
    "handles prompt failure %p",
    async (message, expectedClassification) => {
      const { agent } = createAgent();
      mockCodexConnection.newSession.mockResolvedValue({
        sessionId: "session-1",
        modes: { currentModeId: "auto", availableModes: [] },
        configOptions: [],
      } satisfies Partial<NewSessionResponse>);
      await agent.newSession({
        cwd: process.cwd(),
      } as never);

      const promptError = new Error(message);
      mockCodexConnection.prompt.mockRejectedValueOnce(promptError);

      let thrown: unknown;
      try {
        await agent.prompt({
          sessionId: "session-1",
          prompt: [{ type: "text", text: "A" }],
        } as never);
      } catch (error) {
        thrown = error;
      }

      if (!expectedClassification) {
        expect(thrown).toBe(promptError);
        return;
      }

      expect(thrown).toMatchObject({
        data: {
          classification: expectedClassification,
          result: message,
        },
      });
    },
  );

  it("does not let a classified failing prompt block subsequent prompts", async () => {
    const { agent } = createAgent();
    mockCodexConnection.newSession.mockResolvedValue({
      sessionId: "session-1",
      modes: { currentModeId: "auto", availableModes: [] },
      configOptions: [],
    } satisfies Partial<NewSessionResponse>);
    await agent.newSession({
      cwd: process.cwd(),
    } as never);

    mockCodexConnection.prompt.mockRejectedValueOnce(
      new Error("API Error: 529 overloaded_error"),
    );
    mockCodexConnection.prompt.mockResolvedValueOnce({
      stopReason: "end_turn",
    });

    await expect(
      agent.prompt({
        sessionId: "session-1",
        prompt: [{ type: "text", text: "A" }],
      } as never),
    ).rejects.toMatchObject({
      data: {
        classification: "upstream_provider_failure",
        result: "API Error: 529 overloaded_error",
      },
    });

    await expect(
      agent.prompt({
        sessionId: "session-1",
        prompt: [{ type: "text", text: "B" }],
      } as never),
    ).resolves.toEqual({ stopReason: "end_turn" });
  });

  describe("structured output injection", () => {
    const schema = {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    } as const;

    beforeEach(async () => {
      // The resolver checks existsSync to find the compiled MCP script.
      // In unit tests the dist asset isn't on the walk-up path, so we
      // make the first candidate succeed. Nothing in this test actually
      // spawns the script — the agent only forwards the path to codex-acp.
      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(true);
    });

    it("injects the create_output MCP server and system-prompt note when jsonSchema and callback are present", async () => {
      const { agent } = createAgent({}, { onStructuredOutput: vi.fn() });
      mockCodexConnection.newSession.mockResolvedValue({
        sessionId: "session-1",
        modes: { currentModeId: "auto", availableModes: [] },
        configOptions: [],
      } satisfies Partial<NewSessionResponse>);

      await agent.newSession({
        cwd: process.cwd(),
        mcpServers: [{ name: "existing", command: "echo", args: [], env: [] }],
        _meta: { jsonSchema: schema, systemPrompt: "be terse." },
      } as never);

      const forwarded = mockCodexConnection.newSession.mock.calls[0][0] as {
        mcpServers: Array<{ name: string; command: string; env: unknown }>;
        _meta: { systemPrompt: string };
      };

      // Existing MCP server is preserved; ours is appended.
      expect(forwarded.mcpServers).toHaveLength(2);
      expect(forwarded.mcpServers[0].name).toBe("existing");
      expect(forwarded.mcpServers[1].name).toBe("posthog_output");
      expect(forwarded.mcpServers[1].command).toBe(process.execPath);

      // The schema is forwarded base64-encoded so codex-acp doesn't have
      // to escape it through a shell.
      const envEntry = (
        forwarded.mcpServers[1].env as Array<{ name: string; value: string }>
      ).find((e) => e.name === "POSTHOG_OUTPUT_SCHEMA");
      expect(envEntry).toBeDefined();
      const decoded = JSON.parse(
        Buffer.from(envEntry?.value ?? "", "base64").toString("utf-8"),
      );
      expect(decoded).toEqual(schema);

      // Existing systemPrompt is preserved with the structured-output
      // instruction appended (not overwritten).
      expect(forwarded._meta.systemPrompt.startsWith("be terse.")).toBe(true);
      expect(forwarded._meta.systemPrompt).toContain("create_output");
    });

    it("is a no-op when jsonSchema is absent", async () => {
      const { agent } = createAgent({}, { onStructuredOutput: vi.fn() });
      mockCodexConnection.newSession.mockResolvedValue({
        sessionId: "session-1",
        modes: { currentModeId: "auto", availableModes: [] },
        configOptions: [],
      } satisfies Partial<NewSessionResponse>);

      await agent.newSession({
        cwd: process.cwd(),
        mcpServers: [],
      } as never);

      const forwarded = mockCodexConnection.newSession.mock.calls[0][0] as {
        mcpServers: unknown[];
        _meta?: { systemPrompt?: string };
      };
      expect(forwarded.mcpServers).toEqual([]);
      expect(forwarded._meta?.systemPrompt).toBeUndefined();
    });

    it("is a no-op when onStructuredOutput callback is not wired", async () => {
      const { agent } = createAgent();
      mockCodexConnection.newSession.mockResolvedValue({
        sessionId: "session-1",
        modes: { currentModeId: "auto", availableModes: [] },
        configOptions: [],
      } satisfies Partial<NewSessionResponse>);

      await agent.newSession({
        cwd: process.cwd(),
        mcpServers: [],
        _meta: { jsonSchema: schema },
      } as never);

      const forwarded = mockCodexConnection.newSession.mock.calls[0][0] as {
        mcpServers: unknown[];
      };
      expect(forwarded.mcpServers).toEqual([]);
    });

    it("also injects on loadSession", async () => {
      const { agent } = createAgent({}, { onStructuredOutput: vi.fn() });
      mockCodexConnection.loadSession.mockResolvedValue({
        modes: { currentModeId: "auto", availableModes: [] },
        configOptions: [],
      } satisfies Partial<LoadSessionResponse>);

      await agent.loadSession({
        sessionId: "session-1",
        cwd: process.cwd(),
        mcpServers: [],
        _meta: { jsonSchema: schema },
      } as never);

      const forwarded = mockCodexConnection.loadSession.mock.calls[0][0] as {
        mcpServers: Array<{ name: string }>;
      };
      expect(forwarded.mcpServers.map((s) => s.name)).toContain(
        "posthog_output",
      );
    });
  });

  it("broadcasts user prompt as user_message_chunk before delegating to codex-acp", async () => {
    const { agent, client } = createAgent();
    // Seed an active session so prompt() has the state it expects.
    mockCodexConnection.newSession.mockResolvedValue({
      sessionId: "session-1",
      modes: { currentModeId: "auto", availableModes: [] },
      configOptions: [],
    } satisfies Partial<NewSessionResponse>);
    await agent.newSession({
      cwd: process.cwd(),
    } as never);

    const callOrder: string[] = [];
    client.sessionUpdate.mockImplementation(async () => {
      callOrder.push("sessionUpdate");
    });
    mockCodexConnection.prompt.mockImplementation(async () => {
      callOrder.push("prompt");
      return { stopReason: "end_turn" };
    });

    await agent.prompt({
      sessionId: "session-1",
      prompt: [
        { type: "text", text: "first chunk" },
        { type: "text", text: "second chunk" },
      ],
    } as never);

    expect(client.sessionUpdate).toHaveBeenCalledTimes(2);
    expect(client.sessionUpdate).toHaveBeenNthCalledWith(1, {
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "first chunk" },
      },
    });
    expect(client.sessionUpdate).toHaveBeenNthCalledWith(2, {
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "second chunk" },
      },
    });
    // Broadcast must land before the prompt reaches codex-acp so the user
    // turn is persisted even if the underlying prompt fails.
    expect(callOrder).toEqual(["sessionUpdate", "sessionUpdate", "prompt"]);
  });
});
