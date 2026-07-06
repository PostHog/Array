import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type {
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POSTHOG_NOTIFICATIONS } from "../../acp-extensions";
import { createMockQuery, type MockQuery } from "../../test/mocks/claude-sdk";
import { Pushable } from "../../utils/streams";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

vi.mock("./mcp/tool-metadata", () => ({
  fetchMcpToolMetadata: vi.fn().mockResolvedValue(undefined),
  getConnectedMcpServerNames: vi.fn().mockReturnValue([]),
  getCachedMcpTools: vi.fn().mockReturnValue([]),
  clearMcpToolMetadataCache: vi.fn(),
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
    buildInProcessMcpServers: () => ({}),
    localToolsServerNames: [] as string[],
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
    turnQueue: [],
    activeTurn: null,
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

  return { query, input };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function send(query: MockQuery, message: unknown): Promise<void> {
  query._mockHelpers.sendMessage(message as SDKMessage);
  await tick();
}

// Replays the prompt's own user message back through the query so the consumer
// activates its Turn before the terminal result arrives.
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

function resultSuccess(sessionId: string, uuid: string) {
  return {
    type: "result",
    subtype: "success",
    session_id: sessionId,
    uuid,
    result: "",
    is_error: false,
    usage: {},
    modelUsage: {},
  };
}

function taskNotificationResult(sessionId: string, uuid: string) {
  return {
    ...resultSuccess(sessionId, uuid),
    origin: { kind: "task-notification" },
  };
}

function taskNotification(sessionId: string) {
  return {
    type: "system",
    subtype: "task_notification",
    session_id: sessionId,
    uuid: "task-note-1",
    task_id: "task-1",
    status: "completed",
    output_file: "/tmp/task-1.out",
    summary: "Background command completed",
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

async function runTurn(
  agent: Agent,
  client: ClientMocks,
  query: MockQuery,
  input: Pushable<SDKUserMessage>,
  sessionId: string,
  text: string,
): Promise<void> {
  const promptPromise = agent.prompt({
    sessionId,
    prompt: [{ type: "text", text: "hi" }],
  });
  await tick();
  await echoUserMessage(query, input);
  await send(query, assistantMessage(sessionId, `msg-${text}`, text));
  await send(query, resultSuccess(sessionId, `result-${text}`));
  const result = await promptPromise;
  expect(result.stopReason).toBe("end_turn");
  expect(messageChunkTexts(client.sessionUpdate.mock.calls)).toContain(text);
}

// Regression coverage for #1919: a backgrounded task (Bash run_in_background /
// Monitor) wakes the agent AFTER its turn settled, and the SDK emits that
// follow-up turn with no prompt() call in flight. The session-lifetime
// consumer must forward those messages live, not leave them queued until the
// next user prompt.
describe("ClaudeAcpAgent — background wake-ups between turns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards agent messages produced after the turn settled", async () => {
    const { agent, client } = makeAgent();
    const sessionId = "s-wake";
    const { query, input } = installFakeSession(agent, sessionId);

    await runTurn(agent, client, query, input, sessionId, "waiting for task");

    // The turn is over; the background task completes and wakes the agent.
    await send(query, taskNotification(sessionId));
    await send(
      query,
      assistantMessage(sessionId, "msg-wake", "the test succeeded"),
    );

    expect(client.extNotification).toHaveBeenCalledWith(
      POSTHOG_NOTIFICATIONS.TASK_NOTIFICATION,
      expect.objectContaining({ sessionId, taskId: "task-1" }),
    );
    expect(messageChunkTexts(client.sessionUpdate.mock.calls)).toContain(
      "the test succeeded",
    );
  });

  it("streams wake-up deltas live and drops the assembled duplicate", async () => {
    const { agent, client } = makeAgent();
    const sessionId = "s-wake-stream";
    const { query, input } = installFakeSession(agent, sessionId);

    await runTurn(agent, client, query, input, sessionId, "waiting");

    await send(query, messageStart(sessionId, "msg-wake"));
    await send(query, textDelta(sessionId, "woke up"));
    await send(query, assistantMessage(sessionId, "msg-wake", "woke up"));

    const texts = messageChunkTexts(client.sessionUpdate.mock.calls);
    expect(texts.filter((text) => text === "woke up")).toHaveLength(1);
  });

  it("keeps a task-notification result from settling the next queued turn", async () => {
    const { agent, client } = makeAgent();
    const sessionId = "s-wake-result";
    const { query, input } = installFakeSession(agent, sessionId);

    await runTurn(agent, client, query, input, sessionId, "waiting");

    // A second prompt is queued but not yet echoed when the wake-up turn's
    // terminal result arrives. That result is background work: it must not
    // resolve the queued turn.
    const promptPromise = agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "follow-up" }],
    });
    await tick();
    await send(
      query,
      assistantMessage(sessionId, "msg-wake", "the test succeeded"),
    );
    await send(query, taskNotificationResult(sessionId, "wake-result"));

    let settled = false;
    void promptPromise.then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);

    await echoUserMessage(query, input);
    await send(query, assistantMessage(sessionId, "msg-2", "done"));
    await send(query, resultSuccess(sessionId, "result-2"));

    const result = await promptPromise;
    expect(result.stopReason).toBe("end_turn");
    const texts = messageChunkTexts(client.sessionUpdate.mock.calls);
    expect(texts).toContain("the test succeeded");
    expect(texts).toContain("done");
  });

  it("runs a normal turn after wake-up output", async () => {
    const { agent, client } = makeAgent();
    const sessionId = "s-wake-next";
    const { query, input } = installFakeSession(agent, sessionId);

    await runTurn(agent, client, query, input, sessionId, "waiting");

    await send(query, assistantMessage(sessionId, "msg-wake", "woke up"));
    await send(query, taskNotificationResult(sessionId, "wake-result"));

    await runTurn(agent, client, query, input, sessionId, "next answer");
    expect(messageChunkTexts(client.sessionUpdate.mock.calls)).toContain(
      "woke up",
    );
  });
});
