import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type SdkQueryHandle = {
  interrupt: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  setMcpServers: ReturnType<typeof vi.fn>;
  supportedCommands: ReturnType<typeof vi.fn>;
  initializationResult: ReturnType<typeof vi.fn>;
  [Symbol.asyncIterator]: () => AsyncIterator<never>;
};

function makeQueryHandle(): SdkQueryHandle {
  return {
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setMcpServers: vi.fn().mockResolvedValue(undefined),
    supportedCommands: vi.fn().mockResolvedValue([]),
    initializationResult: vi.fn().mockResolvedValue({
      result: "success",
      commands: [],
      models: [],
    }),
    [Symbol.asyncIterator]: async function* () {
      /* never yields */
    } as never,
  };
}

const createdQueries: SdkQueryHandle[] = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
    const handle = makeQueryHandle();
    createdQueries.push(handle);
    return handle;
  }),
  getSessionMessages: vi.fn().mockResolvedValue([]),
  listSessions: vi.fn().mockResolvedValue([]),
  createSdkMcpServer: vi.fn(() => ({
    type: "sdk",
    name: "stub",
    instance: {},
  })),
  tool: vi.fn(),
}));

vi.mock("./mcp/tool-metadata", () => ({
  fetchMcpToolMetadata: vi.fn().mockResolvedValue(undefined),
  getConnectedMcpServerNames: vi.fn().mockReturnValue([]),
  setMcpToolApprovalStates: vi.fn(),
  getMcpToolApprovalState: vi.fn().mockReturnValue("approved"),
  getMcpToolMetadata: vi.fn().mockReturnValue(undefined),
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

function getModelConfigOption(response: {
  configOptions?: Array<{ id: string; currentValue?: unknown }> | null;
}) {
  return response.configOptions?.find((opt) => opt.id === "model");
}

// Real temp dirs: createSession validates cwd and SettingsManager reads
// settings from disk; CLAUDE_CONFIG_DIR keeps both away from the real home.
const cwd = mkdtempSync(path.join(os.tmpdir(), "claude-agent-test-cwd-"));
const configDir = mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-test-config-"),
);
const savedEnv = {
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
};

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
  process.env.ANTHROPIC_BASE_URL = savedEnv.ANTHROPIC_BASE_URL;
  process.env.CLAUDE_CONFIG_DIR = savedEnv.CLAUDE_CONFIG_DIR;
  if (savedEnv.ANTHROPIC_BASE_URL === undefined) {
    delete process.env.ANTHROPIC_BASE_URL;
  }
  if (savedEnv.CLAUDE_CONFIG_DIR === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

describe("ClaudeAcpAgent session model on resume", () => {
  beforeEach(() => {
    createdQueries.length = 0;
    // No gateway: fetchGatewayModels returns [] and the requested model is
    // kept as a custom option — mirrors the gateway-outage failure mode.
    delete process.env.ANTHROPIC_BASE_URL;
    process.env.CLAUDE_CONFIG_DIR = configDir;
  });

  // The SDK does not carry the model across resume — without an explicit
  // setModel the resumed session silently runs the SDK default (opus).
  it.each([
    {
      name: "applies meta.model to the SDK when resuming",
      sessionId: "0197a000-0000-7000-8000-000000000001",
      model: "claude-fable-5",
      expectedSetModel: "claude-fable-5",
      expectedCurrentValue: "claude-fable-5",
    },
    {
      name: "pins the default model explicitly when resuming without meta.model",
      sessionId: "0197a000-0000-7000-8000-000000000002",
      model: undefined,
      expectedSetModel: "opus",
      expectedCurrentValue: "claude-opus-4-8",
    },
  ])(
    "$name",
    async ({ sessionId, model, expectedSetModel, expectedCurrentValue }) => {
      const agent = makeAgent();

      const response = await agent.resumeSession({
        sessionId,
        cwd,
        mcpServers: [],
        _meta: { taskRunId: "run-1", model },
      });

      expect(createdQueries).toHaveLength(1);
      expect(createdQueries[0].setModel).toHaveBeenCalledWith(expectedSetModel);
      expect(getModelConfigOption(response)?.currentValue).toBe(
        expectedCurrentValue,
      );
    },
  );

  it("does not call setModel for a new session on the default model", async () => {
    const agent = makeAgent();

    await agent.newSession({
      cwd,
      mcpServers: [],
      _meta: { taskRunId: "run-3" },
    });

    // New sessions already pass options.model to the SDK at spawn.
    expect(createdQueries).toHaveLength(1);
    expect(createdQueries[0].setModel).not.toHaveBeenCalled();
  });
});
