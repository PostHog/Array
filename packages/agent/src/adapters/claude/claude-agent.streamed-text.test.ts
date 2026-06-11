import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type {
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
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
): { query: MockQuery; input: Pushable<SDKUserMessage> } {
  const query = createMockQuery();
  const input = new Pushable<SDKUserMessage>();
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
    taskState: new Map(),
  };

  (agent as unknown as { session: typeof session }).session = session;
  (agent as unknown as { sessionId: string }).sessionId = sessionId;

  return { query, input };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function send(query: MockQuery, message: unknown): Promise<void> {
  query._mockHelpers.sendMessage(message as SDKMessage);
  await tick();
}

// Replays the prompt's own user message back through the query so
// `promptReplayed` flips and the terminal `result` message is not skipped as a
// background-task result.
async function echoUserMessage(
  query: MockQuery,
  input: Pushable<SDKUserMessage>,
): Promise<void> {
  const { value: pushed } = await input[Symbol.asyncIterator]().next();
  await send(query, pushed);
}

function messageStart(sessionId: string, apiId: string) {
  return {
    type: "stream_event",
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: `start-${apiId}`,
    event: { type: "message_start", message: { id: apiId, usage: {} } },
  };
}

function textDelta(sessionId: string, text: string) {
  return {
    type: "stream_event",
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: `delta-${text}`,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
  };
}

function assistantMessage(sessionId: string, apiId: string, text: string) {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: `assistant-${apiId}`,
    message: {
      id: apiId,
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

function resultSuccess(sessionId: string) {
  return {
    type: "result",
    subtype: "success",
    session_id: sessionId,
    uuid: "result-1",
    result: "",
    is_error: false,
    usage: {},
    modelUsage: {},
  };
}

function messageChunkTexts(
  calls: ClientMocks["sessionUpdate"]["mock"]["calls"],
): string[] {
  return calls
    .map(
      ([call]) =>
        (
          call as {
            update?: { sessionUpdate?: string; content?: { text?: string } };
          }
        ).update,
    )
    .filter((update) => update?.sessionUpdate === "agent_message_chunk")
    .map((update) => update?.content?.text ?? "");
}

describe("ClaudeAcpAgent.prompt — streamed assistant text wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits streamed text once and drops the assembled duplicate", async () => {
    const { agent, client } = makeAgent();
    const sessionId = "s-streamed";
    const { query, input } = installFakeSession(agent, sessionId);

    const promptPromise = agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
    });
    await tick();

    await echoUserMessage(query, input);
    await send(query, messageStart(sessionId, "msg_1"));
    await send(query, textDelta(sessionId, "hello"));
    await send(query, assistantMessage(sessionId, "msg_1", "hello"));
    await send(query, resultSuccess(sessionId));

    const result = await promptPromise;
    expect(result.stopReason).toBe("end_turn");
    expect(messageChunkTexts(client.sessionUpdate.mock.calls)).toEqual([
      "hello",
    ]);
  });

  it("forwards assembled text when no deltas streamed (gateway path)", async () => {
    const { agent, client } = makeAgent();
    const sessionId = "s-gateway";
    const { query, input } = installFakeSession(agent, sessionId);

    const promptPromise = agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
    });
    await tick();

    await echoUserMessage(query, input);
    await send(query, assistantMessage(sessionId, "msg_2", "gateway answer"));
    await send(query, resultSuccess(sessionId));

    const result = await promptPromise;
    expect(result.stopReason).toBe("end_turn");
    expect(messageChunkTexts(client.sessionUpdate.mock.calls)).toEqual([
      "gateway answer",
    ]);
  });
});
