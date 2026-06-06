import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockQuery, type MockQuery } from "../../test/mocks/claude-sdk";
import { Pushable } from "../../utils/streams";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

vi.mock("./mcp/tool-metadata", () => ({
  fetchMcpToolMetadata: vi.fn().mockResolvedValue(undefined),
  getConnectedMcpServerNames: vi.fn().mockReturnValue([]),
  setMcpToolApprovalStates: vi.fn(),
  isMcpToolReadOnly: vi.fn().mockReturnValue(false),
  getMcpToolMetadata: vi.fn().mockReturnValue(undefined),
  getMcpToolApprovalState: vi.fn().mockReturnValue(undefined),
}));

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

function installFakeSession(
  agent: Agent,
  sessionId: string,
  knownSlashCommands?: Set<string>,
): MockQuery {
  const query = createMockQuery();
  const input = new Pushable();
  const abortController = new AbortController();

  const session = {
    query,
    queryOptions: { sessionId, cwd: "/tmp/repo", abortController },
    input,
    cancelled: false,
    interruptReason: undefined,
    settingsManager: { dispose: vi.fn(), getRepoRoot: () => "/tmp/repo" },
    permissionMode: "default" as const,
    abortController,
    accumulatedUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
    },
    sessionResources: new Set(),
    configOptions: [],
    promptRunning: false,
    pendingMessages: new Map(),
    nextPendingOrder: 0,
    cwd: "/tmp/repo",
    notificationHistory: [] as unknown[],
    taskRunId: "run-1",
    lastContextWindowSize: 200_000,
    modelId: "claude-sonnet-4-6",
    knownSlashCommands,
  };

  (agent as unknown as { session: typeof session }).session = session;
  (agent as unknown as { sessionId: string }).sessionId = sessionId;

  return query;
}

function findUnsupportedChunkText(
  calls: ClientMocks["sessionUpdate"]["mock"]["calls"],
): string | undefined {
  const match = calls.find(([call]) => {
    const update = (
      call as {
        update?: { sessionUpdate?: string; content?: { text?: string } };
      }
    ).update;
    return (
      update?.sessionUpdate === "agent_message_chunk" &&
      update?.content?.text?.toLowerCase().includes("unsupported")
    );
  });
  return (match?.[0] as { update: { content: { text: string } } } | undefined)
    ?.update.content.text;
}

describe("ClaudeAcpAgent.prompt — early idle handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const cases = [
    {
      label: "unsupported slash command surfaces error and ends turn",
      sessionId: "s-slash",
      prompt: "/plugin install slack",
      knownCommands: undefined,
      expectsUnsupportedChunk: true,
      commandInMessage: "/plugin",
    },
    {
      label: "non-slash prompt with early idle is silently skipped",
      sessionId: "s-regular",
      prompt: "hello",
      knownCommands: undefined,
      expectsUnsupportedChunk: false,
      commandInMessage: null,
    },
    {
      label:
        "known plugin/skill command with early idle is not flagged as unsupported",
      sessionId: "s-skill",
      prompt: "/skills-store use my address pr review skill",
      knownCommands: new Set(["skills-store"]),
      expectsUnsupportedChunk: false,
      commandInMessage: null,
    },
  ] as const;

  it.each(cases)("$label", async (tc) => {
    const { agent, client } = makeAgent();
    const query = installFakeSession(
      agent,
      tc.sessionId,
      tc.knownCommands as Set<string> | undefined,
    );

    const promptPromise = agent.prompt({
      sessionId: tc.sessionId,
      prompt: [{ type: "text", text: tc.prompt }],
    });

    // Let the prompt loop start awaiting the first SDK message.
    await new Promise((resolve) => setImmediate(resolve));

    query._mockHelpers.sendMessage({
      type: "system",
      subtype: "session_state_changed",
      state: "idle",
    } as unknown as SDKMessage);
    query._mockHelpers.complete();

    if (tc.expectsUnsupportedChunk) {
      const result = await promptPromise;
      expect(result.stopReason).toBe("end_turn");

      const text = findUnsupportedChunkText(client.sessionUpdate.mock.calls);
      expect(text).toBeDefined();
      if (tc.commandInMessage) {
        expect(text).toContain(tc.commandInMessage);
      }
    } else {
      // No unsupported chunk; loop falls through to the existing
      // "Session did not end in result" failure path.
      await expect(promptPromise).rejects.toThrow(
        /Session did not end in result/,
      );
      expect(
        findUnsupportedChunkText(client.sessionUpdate.mock.calls),
      ).toBeUndefined();
    }
  });
});
