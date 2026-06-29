import { readFile } from "node:fs/promises";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import { type SetupServerApi, setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getSessionJsonlPath } from "../adapters/claude/session/jsonl-hydration";
import type { PermissionMode } from "../execution-mode";
import type { PostHogAPIClient } from "../posthog-api";
import type { ResumeState } from "../resume";
import {
  createMockApiClient,
  createTaskRun,
  createTestRepo,
  type TestRepo,
} from "../test/fixtures/api";
import { createPostHogHandlers } from "../test/mocks/msw-handlers";
import type { StoredEntry, TaskRun } from "../types";
import {
  AgentServer,
  isTurnCompleteNotification,
  SSE_KEEPALIVE_INTERVAL_MS,
} from "./agent-server";
import { type JwtPayload, SANDBOX_CONNECTION_AUDIENCE } from "./jwt";

const mockedClaudeSdk = vi.hoisted(() => {
  const createSuccessResult = () => ({
    type: "result",
    subtype: "success",
    duration_ms: 100,
    duration_api_ms: 50,
    is_error: false,
    num_turns: 1,
    result: "Done",
    stop_reason: null,
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      output_tokens_details: { thinking_tokens: 0 },
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: {
        ephemeral_1h_input_tokens: 0,
        ephemeral_5m_input_tokens: 0,
      },
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      service_tier: "standard",
      inference_geo: "us",
      iterations: [],
      speed: "standard",
    },
    modelUsage: {},
    permission_denials: [],
    uuid: crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
    session_id: "test-session",
  });

  const query = vi.fn(
    (params: { prompt?: { push?: (message: unknown) => void } }) => {
      const queuedMessages: unknown[] = [];
      let resolveNext: ((value: IteratorResult<unknown, void>) => void) | null =
        null;
      let isDone = false;

      const flushQueue = () => {
        if (!resolveNext) {
          return;
        }

        if (queuedMessages.length > 0) {
          const resolve = resolveNext;
          resolveNext = null;
          resolve({
            value: queuedMessages.shift(),
            done: false,
          });
          return;
        }

        if (isDone) {
          const resolve = resolveNext;
          resolveNext = null;
          resolve({ value: undefined, done: true });
        }
      };

      const enqueue = (message: unknown) => {
        if (isDone) {
          return;
        }
        queuedMessages.push(message);
        flushQueue();
      };

      const prompt = params.prompt;
      if (prompt && typeof prompt.push === "function") {
        const originalPush = prompt.push.bind(prompt);
        prompt.push = (message: unknown) => {
          originalPush(message);

          if (
            message &&
            typeof message === "object" &&
            "uuid" in message &&
            typeof message.uuid === "string"
          ) {
            enqueue({
              type: "user",
              uuid: message.uuid,
              parent_tool_use_id: null,
              message: {
                content: [],
              },
            });
            enqueue(createSuccessResult());
          }
        };
      }

      return {
        next: vi.fn(() => {
          if (queuedMessages.length > 0) {
            return Promise.resolve({
              value: queuedMessages.shift(),
              done: false as const,
            });
          }

          if (isDone) {
            return Promise.resolve({
              value: undefined,
              done: true as const,
            });
          }

          return new Promise<IteratorResult<unknown, void>>((resolve) => {
            resolveNext = resolve;
          });
        }),
        return: vi.fn(() => {
          isDone = true;
          flushQueue();
          return Promise.resolve({ value: undefined, done: true as const });
        }),
        throw: vi.fn((error: Error) => {
          isDone = true;
          flushQueue();
          return Promise.reject(error);
        }),
        [Symbol.asyncIterator]() {
          return this;
        },
        interrupt: vi.fn(async () => {
          isDone = true;
          flushQueue();
        }),
        setPermissionMode: vi.fn().mockResolvedValue(undefined),
        setModel: vi.fn().mockResolvedValue(undefined),
        setMaxThinkingTokens: vi.fn().mockResolvedValue(undefined),
        supportedCommands: vi.fn().mockResolvedValue([]),
        supportedModels: vi.fn().mockResolvedValue([]),
        mcpServerStatus: vi.fn().mockResolvedValue([]),
        accountInfo: vi.fn().mockResolvedValue({}),
        rewindFiles: vi.fn().mockResolvedValue({ canRewind: false }),
        setMcpServers: vi
          .fn()
          .mockResolvedValue({ added: [], removed: [], errors: {} }),
        streamInput: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        initializationResult: vi.fn().mockResolvedValue({
          result: "success",
          commands: [],
          models: [],
        }),
        reconnectMcpServer: vi.fn().mockResolvedValue(undefined),
        toggleMcpServer: vi.fn().mockResolvedValue(undefined),
        supportedAgents: vi.fn().mockResolvedValue([]),
        stopTask: vi.fn().mockResolvedValue(undefined),
        applyFlagSettings: vi.fn().mockResolvedValue(undefined),
        getContextUsage: vi.fn().mockResolvedValue({}),
        reloadPlugins: vi.fn().mockResolvedValue(undefined),
        seedReadState: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue(""),
        backgroundTasks: vi.fn().mockResolvedValue([]),
        [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
      };
    },
  );

  return { query };
});

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal()),
  query: mockedClaudeSdk.query,
}));

interface TestableServer {
  getInitialPromptOverride(run: TaskRun): string | null;
  getClearedPendingUserState(run: TaskRun | null): string[] | null;
  clearPendingInitialPromptState(
    payload: JwtPayload,
    run: TaskRun | null,
  ): Promise<void>;
  detectedPrUrl: string | null;
  buildCloudSystemPrompt(
    prUrl?: string | null,
    slackThreadUrl?: string | null,
    inboxReportUrl?: string | null,
  ): string;
  buildDetectedPrContext(prUrl: string): string;
  buildSessionSystemPrompt(
    prUrl?: string | null,
    slackThreadUrl?: string | null,
    inboxReportUrl?: string | null,
  ): string | { append: string };
  buildCodexInstructions(systemPrompt: string | { append: string }): string;
  getRuntimeAdapter(): "claude" | "codex";
  buildClaudeCodeSessionMeta(
    runtimeAdapter: "claude" | "codex",
  ): { claudeCode: { options: Record<string, unknown> } } | undefined;
}

interface NativeResumeTestServer {
  resumeState: ResumeState | null;
  prepareNativeResume(
    payload: JwtPayload,
    posthogAPI: PostHogAPIClient,
    preTaskRun: TaskRun | null,
    runtimeAdapter: "claude" | "codex",
    cwd: string,
    permissionMode: PermissionMode,
  ): Promise<{ sessionId: string; warm: boolean } | null>;
}

let nextTestPort = 20000;

function getNextTestPort(): number {
  const port = nextTestPort;
  nextTestPort += 1;
  return port;
}

// The Claude Agent SDK has an internal readMessages() loop that rejects with
// "Query closed before response received" during cleanup. The SDK starts this
// promise in the constructor without a .catch() handler, so the rejection is
// unhandled. We suppress it here to prevent vitest from failing the suite.
type Listener = (...args: unknown[]) => void;
const originalListeners: Listener[] = [];

beforeAll(() => {
  originalListeners.push(
    ...process.rawListeners("unhandledRejection").map((l) => l as Listener),
  );
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", (reason: unknown) => {
    if (
      reason instanceof Error &&
      reason.message === "Query closed before response received"
    ) {
      return;
    }
    for (const listener of originalListeners) {
      listener(reason);
    }
  });
});

afterAll(() => {
  process.removeAllListeners("unhandledRejection");
  for (const listener of originalListeners) {
    process.on("unhandledRejection", listener);
  }
});

function createTestJwt(
  payload: JwtPayload,
  privateKey: string,
  expiresInSeconds = 3600,
): string {
  return jwt.sign(
    { ...payload, aud: SANDBOX_CONNECTION_AUDIENCE },
    privateKey,
    {
      algorithm: "RS256",
      expiresIn: expiresInSeconds,
    },
  );
}

function sessionUpdateEntry(
  sessionUpdate: string,
  extra: Record<string, unknown> = {},
): StoredEntry {
  return {
    type: "notification",
    timestamp: new Date().toISOString(),
    notification: {
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate, ...extra } },
    },
  };
}

// Test RSA key pair (2048-bit, for testing only)
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDqh94SYMFsvG4C
Co9BSGjtPr2/OxzuNGr41O4+AMkDQRd9pKO49DhTA4VzwnOvrH8y4eI9N8OQne7B
wpdoouSn4DoDAS/b3SUfij/RoFUSyZiTQoWz0H6o2Vuufiz0Hf+BzlZEVnhSQ1ru
vqSf+4l8cWgeMXaFXgdD5kQ8GjvR5uqKxvO2Env1hMJRKeOOEGgCep/0c6SkMUTX
SeC+VjypVg9+8yPxtIpOQ7XKv+7e/PA0ilqehRQh4fo9BAWjUW1+HnbtsjJAjjfv
ngzIjpajuQVyMi7G79v8OvijhLMJjJBh3TdbVIfi+RkVj/H94UUfKWRfJA0eLykA
VvTiFf0nAgMBAAECggEABkLBQWFW2IXBNAm/IEGEF408uH2l/I/mqSTaBUq1EwKq
U17RRg8y77hg2CHBP9fNf3i7NuIltNcaeA6vRwpOK1MXiVv/QJHLO2fP41Mx4jIC
gi/c7NtsfiprQaG5pnykhP0SnXlndd65bzUkpOasmWdXnbK5VL8ZV40uliInJafE
1Eo9qSYCJxHmivU/4AbiBgygOAo1QIiuuUHcx0YGknLrBaMQETuvWJGE3lxVQ30/
EuRyA3r6BwN2T0z47PZBzvCpg/C1KeoYuKSMwMyEXfl+a8NclqdROkVaenmZpvVH
0lAvFDuPrBSDmU4XJbKCEfwfHjRkiWAFaTrKntGQtQKBgQD/ILoK4U9DkJoKTYvY
9lX7dg6wNO8jGLHNufU8tHhU+QnBMH3hBXrAtIKQ1sGs+D5rq/O7o0Balmct9vwb
CQZ1EpPfa83Thsv6Skd7lWK0JF7g2vVk8kT4nY/eqkgZUWgkfdMp+OMg2drYiIE8
u+sRPTCdq4Tv5miRg0OToX2H/QKBgQDrVR2GXm6ZUyFbCy8A0kttXP1YyXqDVq7p
L4kqyUq43hmbjzIRM4YDN3EvgZvVf6eub6L/3HfKvWD/OvEhHovTvHb9jkwZ3FO+
YQllB/ccAWJs/Dw5jLAsX9O+eIe4lfwROib3vYLnDTAmrXD5VL35R5F0MsdRoxk5
lTCq1sYI8wKBgGA9ZjDIgXAJUjJkwkZb1l9/T1clALiKjjf+2AXIRkQ3lXhs5G9H
8+BRt5cPjAvFsTZIrS6xDIufhNiP/NXt96OeGG4FaqVKihOmhYSW+57cwXWs4zjr
Mx1dwnHKZlw2m0R4unlwy60OwUFBbQ8ODER6gqZXl1Qv5G5Px+Qe3Q25AoGAUl+s
wgfz9r9egZvcjBEQTeuq0pVTyP1ipET7YnqrKSK1G/p3sAW09xNFDzfy8DyK2UhC
agUl+VVoym47UTh8AVWK4R4aDUNOHOmifDbZjHf/l96CxjI0yJOSbq2J9FarsOwG
D9nKJE49eIxlayD6jnM6us27bxwEDF/odSRQlXkCgYEAxn9l/5kewWkeEA0Afe1c
Uf+mepHBLw1Pbg5GJYIZPC6e5+wRNvtFjM5J6h5LVhyb7AjKeLBTeohoBKEfUyUO
rl/ql9qDIh5lJFn3uNh7+r7tmG21Zl2pyh+O8GljjZ25mYhdiwl0uqzVZaINe2Wa
vbMnD1ZQKgL8LHgb02cbTsc=
-----END PRIVATE KEY-----`;

const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6ofeEmDBbLxuAgqPQUho
7T69vzsc7jRq+NTuPgDJA0EXfaSjuPQ4UwOFc8Jzr6x/MuHiPTfDkJ3uwcKXaKLk
p+A6AwEv290lH4o/0aBVEsmYk0KFs9B+qNlbrn4s9B3/gc5WRFZ4UkNa7r6kn/uJ
fHFoHjF2hV4HQ+ZEPBo70ebqisbzthJ79YTCUSnjjhBoAnqf9HOkpDFE10ngvlY8
qVYPfvMj8bSKTkO1yr/u3vzwNIpanoUUIeH6PQQFo1Ftfh527bIyQI43754MyI6W
o7kFcjIuxu/b/Dr4o4SzCYyQYd03W1SH4vkZFY/x/eFFHylkXyQNHi8pAFb04hX9
JwIDAQAB
-----END PUBLIC KEY-----`;

describe("AgentServer HTTP Mode", () => {
  let repo: TestRepo;
  let server: AgentServer | undefined;
  let mswServer: SetupServerApi;
  let appendLogCalls: unknown[][];
  let port: number;

  beforeEach(async () => {
    repo = await createTestRepo("agent-server-http");
    appendLogCalls = [];
    // Use a unique high port per test to avoid reuse and browser-blocked ports.
    port = getNextTestPort();
    mswServer = setupServer(
      ...createPostHogHandlers({
        baseUrl: "http://localhost:8000",
        onAppendLog: (entries) => appendLogCalls.push(entries),
      }),
    );
    mswServer.listen({ onUnhandledRequest: "bypass" });
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }
    mswServer.close();
    await repo.cleanup();
  });

  const createServer = (
    overrides: Partial<ConstructorParameters<typeof AgentServer>[0]> = {},
  ) => {
    server = new AgentServer({
      port,
      jwtPublicKey: TEST_PUBLIC_KEY,
      repositoryPath: repo.path,
      apiUrl: "http://localhost:8000",
      apiKey: "test-api-key",
      projectId: 1,
      mode: "interactive",
      taskId: "test-task-id",
      runId: "test-run-id",
      ...overrides,
    });
    return server;
  };

  const createToken = (overrides = {}) => {
    return createTestJwt(
      {
        run_id: "test-run-id",
        task_id: "test-task-id",
        team_id: 1,
        user_id: 1,
        distinct_id: "test-distinct-id",
        mode: "interactive",
        ...overrides,
      },
      TEST_PRIVATE_KEY,
    );
  };

  describe("GET /health", () => {
    it("returns ok status with active session", async () => {
      await createServer().start();

      const response = await fetch(`http://localhost:${port}/health`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        status: "ok",
        hasSession: true,
        bootMs: expect.any(Number),
      });
    }, 30000);
  });

  describe("turn completion", () => {
    function stubSessionCleanup(testServer: unknown): {
      cleanupSession: (options?: {
        completeEventStream?: boolean;
      }) => Promise<void>;
      eventStreamSender: {
        enqueue: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
      };
    } {
      const cleanupServer = testServer as {
        session: unknown;
        eventStreamSender: {
          enqueue: ReturnType<typeof vi.fn>;
          stop: ReturnType<typeof vi.fn>;
        };
        captureCheckpointState: ReturnType<typeof vi.fn>;
        cleanupSession: (options?: {
          completeEventStream?: boolean;
        }) => Promise<void>;
      };
      cleanupServer.captureCheckpointState = vi.fn(async () => {});
      cleanupServer.eventStreamSender = {
        enqueue: vi.fn(),
        stop: vi.fn(async () => {}),
      };
      cleanupServer.session = {
        payload: { run_id: "run-1" },
        pendingHandoffGitState: undefined,
        logWriter: { flush: vi.fn(async () => {}) },
        acpConnection: { cleanup: vi.fn(async () => {}) },
        sseController: { close: vi.fn() },
      };
      return cleanupServer;
    }

    it("keeps event ingest open for non-terminal session cleanup", async () => {
      const testServer = stubSessionCleanup(createServer());

      await testServer.cleanupSession();

      expect(testServer.eventStreamSender.enqueue).not.toHaveBeenCalled();
      expect(testServer.eventStreamSender.stop).not.toHaveBeenCalled();
    });

    it("stops event ingest for terminal session cleanup without fake task completion", async () => {
      const testServer = stubSessionCleanup(createServer());

      await testServer.cleanupSession({ completeEventStream: true });

      expect(testServer.eventStreamSender.enqueue).not.toHaveBeenCalled();
      expect(testServer.eventStreamSender.stop).toHaveBeenCalledOnce();
    });

    it("writes terminal failure status before completing event ingest", async () => {
      const order: string[] = [];
      const testServer = new AgentServer({
        port,
        jwtPublicKey: TEST_PUBLIC_KEY,
        repositoryPath: repo.path,
        apiUrl: "http://localhost:8000",
        apiKey: "test-api-key",
        projectId: 1,
        mode: "interactive",
        taskId: "test-task-id",
        runId: "test-run-id",
      }) as unknown as {
        eventStreamSender: {
          enqueue: (event: Record<string, unknown>) => void;
          stop: () => Promise<void>;
        };
        posthogAPI: {
          updateTaskRun: (
            taskId: string,
            runId: string,
            payload: Record<string, unknown>,
          ) => Promise<unknown>;
        };
        signalTaskComplete(
          payload: JwtPayload,
          stopReason: string,
          errorMessage?: string,
        ): Promise<void>;
      };
      testServer.eventStreamSender = {
        enqueue: vi.fn(() => {
          order.push("enqueue");
        }),
        stop: vi.fn(async () => {
          order.push("stop");
        }),
      };
      testServer.posthogAPI = {
        updateTaskRun: vi.fn(async () => {
          order.push("update");
          return {};
        }),
      };

      await testServer.signalTaskComplete(
        {
          run_id: "run-1",
          task_id: "task-1",
          team_id: 1,
          user_id: 1,
          distinct_id: "distinct-id",
          mode: "interactive",
        },
        "error",
        "boom",
      );

      expect(order).toEqual(["enqueue", "update", "stop"]);
      expect(testServer.eventStreamSender.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "notification",
          notification: expect.objectContaining({
            method: "_posthog/error",
            params: expect.objectContaining({ error: "boom" }),
          }),
        }),
      );
      expect(testServer.posthogAPI.updateTaskRun).toHaveBeenCalledWith(
        "task-1",
        "run-1",
        {
          status: "failed",
          error_message: "boom",
        },
      );
    });

    it("still stops event ingest when terminal failure status update fails", async () => {
      const testServer = new AgentServer({
        port,
        jwtPublicKey: TEST_PUBLIC_KEY,
        repositoryPath: repo.path,
        apiUrl: "http://localhost:8000",
        apiKey: "test-api-key",
        projectId: 1,
        mode: "interactive",
        taskId: "test-task-id",
        runId: "test-run-id",
      }) as unknown as {
        eventStreamSender: {
          enqueue: (event: Record<string, unknown>) => void;
          stop: () => Promise<void>;
        };
        posthogAPI: {
          updateTaskRun: (
            taskId: string,
            runId: string,
            payload: Record<string, unknown>,
          ) => Promise<unknown>;
        };
        signalTaskComplete(
          payload: JwtPayload,
          stopReason: string,
          errorMessage?: string,
        ): Promise<void>;
      };
      testServer.eventStreamSender = {
        enqueue: vi.fn(),
        stop: vi.fn(async () => {}),
      };
      testServer.posthogAPI = {
        updateTaskRun: vi.fn(async () => {
          throw new Error("update failed");
        }),
      };

      await testServer.signalTaskComplete(
        {
          run_id: "run-1",
          task_id: "task-1",
          team_id: 1,
          user_id: 1,
          distinct_id: "distinct-id",
          mode: "interactive",
        },
        "error",
        "boom",
      );

      expect(testServer.eventStreamSender.enqueue).toHaveBeenCalledOnce();
      expect(testServer.posthogAPI.updateTaskRun).toHaveBeenCalledOnce();
      expect(testServer.eventStreamSender.stop).toHaveBeenCalledOnce();
    });

    it("leaves event ingest open for non-error stop reasons", async () => {
      const testServer = new AgentServer({
        port,
        jwtPublicKey: TEST_PUBLIC_KEY,
        repositoryPath: repo.path,
        apiUrl: "http://localhost:8000",
        apiKey: "test-api-key",
        projectId: 1,
        mode: "interactive",
        taskId: "test-task-id",
        runId: "test-run-id",
      }) as unknown as {
        eventStreamSender: {
          enqueue: (event: Record<string, unknown>) => void;
          stop: () => Promise<void>;
        };
        posthogAPI: {
          updateTaskRun: (
            taskId: string,
            runId: string,
            payload: Record<string, unknown>,
          ) => Promise<unknown>;
        };
        signalTaskComplete(
          payload: JwtPayload,
          stopReason: string,
        ): Promise<void>;
      };
      testServer.eventStreamSender = {
        enqueue: vi.fn(),
        stop: vi.fn(async () => {}),
      };
      testServer.posthogAPI = {
        updateTaskRun: vi.fn(async () => ({})),
      };

      await testServer.signalTaskComplete(
        {
          run_id: "run-1",
          task_id: "task-1",
          team_id: 1,
          user_id: 1,
          distinct_id: "distinct-id",
          mode: "interactive",
        },
        "end_turn",
      );

      expect(testServer.eventStreamSender.enqueue).not.toHaveBeenCalled();
      expect(testServer.eventStreamSender.stop).not.toHaveBeenCalled();
      expect(testServer.posthogAPI.updateTaskRun).not.toHaveBeenCalled();
    });

    function createFailureTestServer() {
      const appendRawLine = vi.fn();
      const testServer = new AgentServer({
        port,
        jwtPublicKey: TEST_PUBLIC_KEY,
        repositoryPath: repo.path,
        apiUrl: "http://localhost:8000",
        apiKey: "test-api-key",
        projectId: 1,
        mode: "interactive",
        taskId: "test-task-id",
        runId: "test-run-id",
      }) as unknown as {
        eventStreamSender: {
          enqueue: ReturnType<typeof vi.fn>;
          stop: ReturnType<typeof vi.fn>;
        };
        posthogAPI: { updateTaskRun: ReturnType<typeof vi.fn> };
        session: unknown;
        handleTurnFailure(
          payload: JwtPayload,
          phase: "initial" | "resume" | "followup",
          error: unknown,
        ): Promise<void>;
      };
      testServer.eventStreamSender = {
        enqueue: vi.fn(),
        stop: vi.fn(async () => {}),
      };
      testServer.posthogAPI = { updateTaskRun: vi.fn(async () => ({})) };
      testServer.session = {
        acpSessionId: "acp-1",
        payload: { run_id: "run-1" },
        logWriter: { appendRawLine, flush: vi.fn(async () => {}) },
      };
      return testServer;
    }

    const interactivePayload: JwtPayload = {
      run_id: "run-1",
      task_id: "task-1",
      team_id: 1,
      user_id: 1,
      distinct_id: "distinct-id",
      mode: "interactive",
    };

    it.each([
      ["genuine agent error (terminal)", "boom", "agent_error", true],
      [
        "transient upstream timeout (recoverable)",
        "API Error: The operation timed out.",
        "upstream_timeout",
        false,
      ],
    ] as const)(
      "tags and handles a follow-up %s",
      async (_name, errorMessage, expectedErrorType, expectsFailed) => {
        const testServer = createFailureTestServer();

        await testServer.handleTurnFailure(
          interactivePayload,
          "followup",
          new Error(errorMessage),
        );

        expect(testServer.eventStreamSender.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            notification: expect.objectContaining({
              method: "session/update",
              params: expect.objectContaining({
                update: expect.objectContaining({
                  sessionUpdate: "error",
                  errorType: expectedErrorType,
                }),
              }),
            }),
          }),
        );

        if (expectsFailed) {
          expect(testServer.posthogAPI.updateTaskRun).toHaveBeenCalledWith(
            "task-1",
            "run-1",
            expect.objectContaining({ status: "failed" }),
          );
        } else {
          expect(testServer.posthogAPI.updateTaskRun).not.toHaveBeenCalled();
        }
      },
    );

    it("persists structured turn completion notifications", () => {
      const appendRawLine = vi.fn();
      const testServer = new AgentServer({
        port,
        jwtPublicKey: TEST_PUBLIC_KEY,
        repositoryPath: repo.path,
        apiUrl: "http://localhost:8000",
        apiKey: "test-api-key",
        projectId: 1,
        mode: "interactive",
        taskId: "test-task-id",
        runId: "test-run-id",
      }) as unknown as {
        session: unknown;
        broadcastTurnComplete(stopReason: string): void;
      };
      testServer.session = {
        acpSessionId: "session-1",
        payload: { run_id: "run-1" },
        logWriter: { appendRawLine },
      };

      testServer.broadcastTurnComplete("end_turn");

      expect(appendRawLine).toHaveBeenCalledTimes(1);
      expect(appendRawLine.mock.calls[0][0]).toBe("run-1");
      expect(JSON.parse(appendRawLine.mock.calls[0][1])).toEqual({
        jsonrpc: "2.0",
        method: "_posthog/turn_complete",
        params: {
          sessionId: "session-1",
          stopReason: "end_turn",
        },
      });
    });

    it("skips one broadcast after the adapter emitted its own turn_complete", () => {
      const appendRawLine = vi.fn();
      const testServer = new AgentServer({
        port,
        jwtPublicKey: TEST_PUBLIC_KEY,
        repositoryPath: repo.path,
        apiUrl: "http://localhost:8000",
        apiKey: "test-api-key",
        projectId: 1,
        mode: "interactive",
        taskId: "test-task-id",
        runId: "test-run-id",
      }) as unknown as {
        session: unknown;
        adapterEmittedTurnComplete: boolean;
        broadcastTurnComplete(stopReason: string): void;
      };
      testServer.session = {
        acpSessionId: "session-1",
        payload: { run_id: "run-1" },
        logWriter: { appendRawLine },
      };
      testServer.adapterEmittedTurnComplete = true;

      testServer.broadcastTurnComplete("end_turn");
      expect(appendRawLine).not.toHaveBeenCalled();

      testServer.broadcastTurnComplete("end_turn");
      expect(appendRawLine).toHaveBeenCalledTimes(1);
    });

    it("recognizes adapter turn_complete notifications on the tapped stream", () => {
      expect(
        isTurnCompleteNotification({
          jsonrpc: "2.0",
          method: "_posthog/turn_complete",
          params: { sessionId: "s", stopReason: "end_turn" },
        }),
      ).toBe(true);
      expect(
        isTurnCompleteNotification({
          jsonrpc: "2.0",
          method: "_posthog/usage_update",
          params: {},
        }),
      ).toBe(false);
      expect(isTurnCompleteNotification(null)).toBe(false);
      expect(isTurnCompleteNotification("turn_complete")).toBe(false);
    });
  });

  describe("GET /events", () => {
    it("returns 401 without authorization header", async () => {
      await createServer().start();

      const response = await fetch(`http://localhost:${port}/events`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe("Missing authorization header");
    }, 20000);

    it("returns 401 with invalid token", async () => {
      await createServer().start();

      const response = await fetch(`http://localhost:${port}/events`, {
        headers: { Authorization: "Bearer invalid-token" },
      });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.code).toBe("invalid_signature");
    }, 20000);

    it("accepts valid JWT and returns SSE stream", async () => {
      await createServer().start();
      const token = createToken();

      const response = await fetch(`http://localhost:${port}/events`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
    }, 20000);

    it("emits transport keepalive comments while idle", async () => {
      const keepaliveCallback: { current: (() => void) | null } = {
        current: null,
      };
      // Pass through to real setInterval for non-keepalive timers; otherwise
      // unrelated internals (undici, http server, MSW) lose their periodic
      // callbacks and can hang the test.
      const realSetInterval = globalThis.setInterval;
      const setIntervalSpy = vi
        .spyOn(globalThis, "setInterval")
        .mockImplementation(((
          callback: (_: undefined) => void,
          timeout?: number,
          ...args: unknown[]
        ) => {
          if (timeout === SSE_KEEPALIVE_INTERVAL_MS) {
            keepaliveCallback.current = () => callback(undefined);
            return setTimeout(() => undefined, 60_000);
          }
          return (realSetInterval as (...rest: unknown[]) => unknown)(
            callback,
            timeout,
            ...args,
          );
        }) as unknown as typeof setInterval);

      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      try {
        const testServer = createServer() as unknown as {
          app: {
            fetch: (request: Request) => Promise<Response> | Response;
          };
          session: unknown;
        };
        testServer.session = {
          payload: {
            run_id: "test-run-id",
            task_id: "test-task-id",
            team_id: 1,
            user_id: 1,
            distinct_id: "test-distinct-id",
            mode: "interactive",
          },
          acpSessionId: "session-1",
          acpConnection: { cleanup: vi.fn().mockResolvedValue(undefined) },
          clientConnection: {},
          sseController: null,
          deviceInfo: { type: "cloud" },
          logWriter: {
            appendRawLine: vi.fn(),
            flush: vi.fn().mockResolvedValue(undefined),
          },
          permissionMode: "default",
          hasDesktopConnected: false,
        };

        const token = createToken();

        const response = await testServer.app.fetch(
          new Request(`http://localhost:${port}/events`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toBeNull();
        reader = response.body?.getReader() ?? null;
        expect(reader).not.toBeNull();
        if (!reader) {
          throw new Error("Expected SSE response body reader");
        }

        await vi.waitFor(
          () => expect(keepaliveCallback.current).not.toBeNull(),
          { timeout: 10_000, interval: 50 },
        );
        const emitKeepalive = keepaliveCallback.current;
        if (!emitKeepalive) {
          throw new Error("Expected keepalive callback to be registered");
        }
        emitKeepalive();

        const decoder = new TextDecoder();
        let streamText = "";
        for (let attempts = 0; attempts < 10; attempts++) {
          const { done, value } = await reader.read();
          if (done) break;
          streamText += decoder.decode(value, { stream: true });
          if (streamText.includes(": keepalive\n\n")) break;
        }

        expect(streamText).toContain(": keepalive\n\n");
        expect(streamText).not.toContain('"type":"keepalive"');
      } finally {
        await reader?.cancel();
        server = undefined;
        setIntervalSpy.mockRestore();
      }
    }, 30000);
  });

  describe("POST /command", () => {
    it("returns 401 without authorization", async () => {
      await createServer().start();

      const response = await fetch(`http://localhost:${port}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "user_message",
          params: { content: "test" },
        }),
      });

      expect(response.status).toBe(401);
    }, 20000);

    it("returns 400 when run_id does not match active session", async () => {
      await createServer().start();
      const token = createToken({ run_id: "different-run-id" });

      const response = await fetch(`http://localhost:${port}/command`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "user_message",
          params: { content: "test" },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("No active session for this run");
    }, 20000);

    it("accepts structured user_message content", async () => {
      await createServer().start();
      const token = createToken({ run_id: "different-run-id" });

      const response = await fetch(`http://localhost:${port}/command`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "user_message",
          params: {
            content: [{ type: "text", text: "test" }],
          },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("No active session for this run");
    }, 20000);

    it("accepts artifact-only user_message payloads", async () => {
      await createServer().start();
      const token = createToken({ run_id: "different-run-id" });

      const response = await fetch(`http://localhost:${port}/command`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "user_message",
          params: {
            artifacts: [
              {
                id: "artifact-1",
                name: "test.txt",
                storage_path: "tasks/artifacts/test.txt",
              },
            ],
          },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("No active session for this run");
    }, 20000);
  });

  describe("404 handling", () => {
    it("returns 404 for unknown routes", async () => {
      await createServer().start();

      const response = await fetch(`http://localhost:${port}/unknown`);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe("Not found");
    }, 20000);
  });

  describe("session lifecycle", () => {
    it("emits _posthog/run_started after session initialization", async () => {
      await createServer().start();

      // The notification is persisted via `logWriter.appendRawLine` which the
      // mock backend's append_log handler captures into `appendLogCalls`.
      await vi.waitFor(
        () => {
          const allEntries = appendLogCalls.flat() as Array<{
            type?: string;
            notification?: {
              method?: string;
              params?: Record<string, unknown>;
            };
          }>;
          const runStarted = allEntries.find(
            (e) => e?.notification?.method === "_posthog/run_started",
          );
          expect(runStarted).toBeDefined();
          expect(runStarted?.notification?.params).toMatchObject({
            runId: "test-run-id",
            taskId: "test-task-id",
          });
          // Agent reports its semver so clients can gate UI features
          // against agent capabilities (e.g. `>=0.40.1`). The exact value
          // is whatever the agent's package.json was at build time.
          expect(typeof runStarted?.notification?.params?.agentVersion).toBe(
            "string",
          );
          expect(
            (runStarted?.notification?.params?.agentVersion as string).length,
          ).toBeGreaterThan(0);
        },
        { timeout: 15000, interval: 100 },
      );
    }, 30000);
  });

  describe("getInitialPromptOverride", () => {
    it("returns override string from run state", () => {
      const s = createServer();
      const run = {
        state: { initial_prompt_override: "do something else" },
      } as unknown as TaskRun;
      const result = (s as unknown as TestableServer).getInitialPromptOverride(
        run,
      );
      expect(result).toBe("do something else");
    });

    it("returns null when override is absent", () => {
      const s = createServer();
      const run = { state: {} } as unknown as TaskRun;
      const result = (s as unknown as TestableServer).getInitialPromptOverride(
        run,
      );
      expect(result).toBeNull();
    });

    it("returns null for whitespace-only override", () => {
      const s = createServer();
      const run = {
        state: { initial_prompt_override: "  " },
      } as unknown as TaskRun;
      const result = (s as unknown as TestableServer).getInitialPromptOverride(
        run,
      );
      expect(result).toBeNull();
    });

    it("returns null for non-string override", () => {
      const s = createServer();
      const run = {
        state: { initial_prompt_override: 42 },
      } as unknown as TaskRun;
      const result = (s as unknown as TestableServer).getInitialPromptOverride(
        run,
      );
      expect(result).toBeNull();
    });

    it("removes pending prompt keys when clearing initial prompt state", async () => {
      const s = createServer();
      const updateTaskRun = vi
        .spyOn(
          (
            s as unknown as {
              posthogAPI: {
                updateTaskRun: (...args: unknown[]) => Promise<unknown>;
              };
            }
          ).posthogAPI,
          "updateTaskRun",
        )
        .mockResolvedValue({} as never);
      const run = {
        id: "test-run-id",
        task: "test-task-id",
        state: {
          sandbox_url: "https://sandbox.example.com",
          sandbox_connect_token: "token",
          pending_user_message: "read this",
          pending_user_artifact_ids: ["artifact-1"],
          pending_user_message_ts: "123.456",
        },
      } as unknown as TaskRun;

      const nextState = (
        s as unknown as TestableServer
      ).getClearedPendingUserState(run);
      expect(nextState).toEqual([
        "pending_user_message",
        "pending_user_artifact_ids",
        "pending_user_message_ts",
      ]);

      await (s as unknown as TestableServer).clearPendingInitialPromptState(
        {
          run_id: "test-run-id",
          task_id: "test-task-id",
          team_id: 1,
          user_id: 1,
          distinct_id: "test-distinct-id",
          mode: "interactive",
        },
        run,
      );

      expect(updateTaskRun).toHaveBeenCalledWith(
        "test-task-id",
        "test-run-id",
        {
          state_remove_keys: [
            "pending_user_message",
            "pending_user_artifact_ids",
            "pending_user_message_ts",
          ],
        },
      );
    });
  });

  describe("runtime adapter selection", () => {
    it("defaults to claude when no runtime adapter is configured", () => {
      const s = createServer();

      expect((s as unknown as TestableServer).getRuntimeAdapter()).toBe(
        "claude",
      );
    });

    it("uses codex when the runtime adapter is configured", () => {
      const s = createServer({ runtimeAdapter: "codex" });

      expect((s as unknown as TestableServer).getRuntimeAdapter()).toBe(
        "codex",
      );
    });

    it("flattens append-style prompts into plain codex instructions", () => {
      const s = createServer({
        claudeCode: {
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: "User codex instructions",
          },
        },
      });

      const sessionPrompt = (
        s as unknown as TestableServer
      ).buildSessionSystemPrompt("https://github.com/PostHog/code/pull/1");

      expect(typeof sessionPrompt).toBe("object");
      expect(
        (s as unknown as TestableServer).buildCodexInstructions(sessionPrompt),
      ).toContain("User codex instructions");
      expect(
        (s as unknown as TestableServer).buildCodexInstructions(sessionPrompt),
      ).toContain("Cloud Task Execution");
    });
  });

  describe("buildClaudeCodeSessionMeta", () => {
    it("sends claude reasoning effort even when no plugins are configured", () => {
      const s = createServer({ reasoningEffort: "high" });

      const meta = (s as unknown as TestableServer).buildClaudeCodeSessionMeta(
        "claude",
      );

      expect(meta?.claudeCode.options).toEqual({ effort: "high" });
    });

    it("does not send claudeCode effort for codex runs", () => {
      const s = createServer({ reasoningEffort: "high" });

      const meta = (s as unknown as TestableServer).buildClaudeCodeSessionMeta(
        "codex",
      );

      expect(meta).toBeUndefined();
    });

    it("returns undefined when neither plugins nor effort are set", () => {
      const s = createServer();

      const meta = (s as unknown as TestableServer).buildClaudeCodeSessionMeta(
        "claude",
      );

      expect(meta).toBeUndefined();
    });

    it("includes both plugins and effort for claude runs", () => {
      const s = createServer({
        reasoningEffort: "medium",
        claudeCode: { plugins: [{ type: "local", path: "/tmp/plugin" }] },
      });

      const meta = (s as unknown as TestableServer).buildClaudeCodeSessionMeta(
        "claude",
      );

      expect(meta?.claudeCode.options).toEqual({
        plugins: [{ type: "local", path: "/tmp/plugin" }],
        effort: "medium",
      });
    });

    it("returns only plugins when effort is not set", () => {
      const s = createServer({
        claudeCode: { plugins: [{ type: "local", path: "/tmp/plugin" }] },
      });

      const meta = (s as unknown as TestableServer).buildClaudeCodeSessionMeta(
        "claude",
      );

      expect(meta?.claudeCode.options).toEqual({
        plugins: [{ type: "local", path: "/tmp/plugin" }],
      });
    });
  });

  describe("native resume", () => {
    it("hydrates cold sessions from S3 logs instead of cached resume conversation", async () => {
      const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = join(repo.path, ".claude-test");

      try {
        const s = createServer() as unknown as NativeResumeTestServer;
        s.resumeState = {
          conversation: [
            {
              role: "user",
              content: [{ type: "text", text: "continue" }],
            },
            {
              role: "assistant",
              content: [{ type: "text", text: "visible answer only" }],
            },
          ],
          latestGitCheckpoint: null,
          interrupted: false,
          logEntryCount: 3,
          sessionId: "prior-session",
        };

        const posthogAPI = createMockApiClient();
        (posthogAPI.getTaskRun as ReturnType<typeof vi.fn>).mockResolvedValue(
          createTaskRun({ id: "previous-run", log_url: "s3://logs" }),
        );
        (
          posthogAPI.fetchTaskRunLogs as ReturnType<typeof vi.fn>
        ).mockResolvedValue([
          sessionUpdateEntry("user_message", {
            content: { type: "text", text: "continue" },
          }),
          sessionUpdateEntry("agent_thought_chunk", {
            content: {
              type: "thinking",
              thinking: "preserve extended thinking",
            },
          }),
          sessionUpdateEntry("agent_message", {
            content: { type: "text", text: "visible answer" },
          }),
        ]);

        const result = await s.prepareNativeResume(
          {
            task_id: "test-task-id",
            run_id: "test-run-id",
            team_id: 1,
            user_id: 1,
            distinct_id: "test-distinct-id",
            mode: "interactive",
          },
          posthogAPI,
          createTaskRun({
            id: "test-run-id",
            state: { resume_from_run_id: "previous-run" },
          }),
          "claude",
          repo.path,
          "bypassPermissions",
        );

        expect(result).toEqual({ sessionId: "prior-session", warm: false });
        expect(posthogAPI.fetchTaskRunLogs).toHaveBeenCalledTimes(1);

        const jsonl = await readFile(
          getSessionJsonlPath("prior-session", repo.path),
          "utf-8",
        );
        const blocks = jsonl
          .trim()
          .split("\n")
          .flatMap((line) => {
            const parsed = JSON.parse(line) as {
              message?: { content?: unknown[] };
            };
            return parsed.message?.content ?? [];
          });

        expect(blocks).toContainEqual({
          type: "thinking",
          thinking: "preserve extended thinking",
        });
      } finally {
        if (originalConfigDir === undefined) {
          delete process.env.CLAUDE_CONFIG_DIR;
        } else {
          process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
        }
      }
    });
  });

  describe("PR attribution", () => {
    const PR_URL = "https://github.com/PostHog/posthog.com/pull/17764";
    const payload: JwtPayload = {
      task_id: "t",
      run_id: "r",
      team_id: 1,
      user_id: 1,
      distinct_id: "d",
      mode: "interactive",
    };

    // The cloud sandbox frames a created PR's URL inside terminal output, on a
    // tool_call_update that carries no toolName/bashCommand — the case the old
    // detector missed. Attribution must work from the serialized update alone.
    const terminalUpdate = (url: string) => ({
      sessionUpdate: "tool_call_update",
      _meta: { terminal_output: `Creating draft pull request...\n${url}\n` },
    });

    type PrTestServer = {
      maybeAttachCreatedPr(
        p: JwtPayload,
        u: Record<string, unknown> | undefined,
      ): void;
      fetchPrCreatedAt(url: string): Promise<string | null>;
      detectedPrUrl: string | null;
      posthogAPI: { updateTaskRun: ReturnType<typeof vi.fn> };
    };

    const justNow = () => new Date().toISOString();
    const longAgo = "2020-01-01T00:00:00Z";

    const setup = (prCreatedAt: string | null): PrTestServer => {
      const s = createServer() as unknown as PrTestServer;
      s.fetchPrCreatedAt = vi.fn(async () => prCreatedAt);
      s.posthogAPI = { updateTaskRun: vi.fn(async () => ({})) };
      return s;
    };

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("attributes a PR created just now from terminal output alone", async () => {
      const s = setup(justNow());
      s.maybeAttachCreatedPr(payload, terminalUpdate(PR_URL));
      await flush();
      expect(s.posthogAPI.updateTaskRun).toHaveBeenCalledWith("t", "r", {
        output: { pr_url: PR_URL },
      });
      expect(s.detectedPrUrl).toBe(PR_URL);
    });

    it("does not attribute an older PR the run only viewed (e.g. on a long run)", async () => {
      const s = setup(longAgo);
      s.maybeAttachCreatedPr(payload, terminalUpdate(PR_URL));
      await flush();
      expect(s.posthogAPI.updateTaskRun).not.toHaveBeenCalled();
      expect(s.detectedPrUrl).toBeNull();
    });

    it("ignores updates with no PR URL", async () => {
      const s = setup(justNow());
      s.maybeAttachCreatedPr(payload, { sessionUpdate: "agent_thought_chunk" });
      await flush();
      expect(s.fetchPrCreatedAt).not.toHaveBeenCalled();
      expect(s.posthogAPI.updateTaskRun).not.toHaveBeenCalled();
    });

    it("attributes once and looks up GitHub once across repeated updates", async () => {
      const s = setup(justNow());
      s.maybeAttachCreatedPr(payload, terminalUpdate(PR_URL));
      s.maybeAttachCreatedPr(payload, terminalUpdate(PR_URL));
      s.maybeAttachCreatedPr(payload, terminalUpdate(PR_URL));
      await flush();
      expect(s.fetchPrCreatedAt).toHaveBeenCalledTimes(1);
      expect(s.posthogAPI.updateTaskRun).toHaveBeenCalledTimes(1);
    });

    it("attributes the most recent PR when a run opens several, in detection order", async () => {
      // output.pr_url holds one value; the latest PR the run created is the useful one.
      const s = setup(justNow());
      const second = "https://github.com/PostHog/posthog.com/pull/17765";
      s.maybeAttachCreatedPr(payload, terminalUpdate(PR_URL));
      s.maybeAttachCreatedPr(payload, terminalUpdate(second));
      await flush();
      expect(s.posthogAPI.updateTaskRun).toHaveBeenCalledTimes(2);
      expect(s.posthogAPI.updateTaskRun).toHaveBeenLastCalledWith("t", "r", {
        output: { pr_url: second },
      });
      expect(s.detectedPrUrl).toBe(second);
    });

    it("does not let an older PR the run only viewed overwrite the one it created", async () => {
      const viewed = "https://github.com/PostHog/posthog.com/pull/1";
      // The created PR reads as recent; the later, merely-viewed PR reads as old.
      const s = setup(justNow());
      s.fetchPrCreatedAt = vi.fn(async (url: string) =>
        url === PR_URL ? justNow() : longAgo,
      );
      s.maybeAttachCreatedPr(payload, terminalUpdate(PR_URL));
      s.maybeAttachCreatedPr(payload, terminalUpdate(viewed));
      await flush();
      expect(s.detectedPrUrl).toBe(PR_URL);
      expect(s.posthogAPI.updateTaskRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("buildCloudSystemPrompt", () => {
    it("returns review-first prompt for existing PRs on non-Slack runs", () => {
      const s = createServer();
      const prompt = (s as unknown as TestableServer).buildCloudSystemPrompt(
        "https://github.com/org/repo/pull/1",
      );
      expect(prompt).toContain("stop with local changes ready for review");
      expect(prompt).toContain("https://github.com/org/repo/pull/1");
      expect(prompt).toContain(
        "Do NOT create new commits, push to the branch, or update the pull request unless the user explicitly asks.",
      );
      expect(prompt).not.toContain("gh pr checkout");
      expect(prompt).not.toContain("Create a draft pull request");
      expect(prompt).toContain("Generated-By: PostHog Code");
      expect(prompt).toContain("Task-Id: test-task-id");
    });

    it("returns default prompt when no prUrl", () => {
      const s = createServer();
      const prompt = (s as unknown as TestableServer).buildCloudSystemPrompt();
      expect(prompt).toContain("stop with local changes ready for review");
      expect(prompt).toContain(
        "Do NOT create a branch, commit, push, or open a pull request unless the user explicitly asks.",
      );
      expect(prompt).toContain("Generated-By: PostHog Code");
      expect(prompt).toContain("Task-Id: test-task-id");
      expect(prompt).not.toContain("gh pr create --draft");
    });

    it("returns default prompt when prUrl is null", () => {
      const s = createServer();
      const prompt = (s as unknown as TestableServer).buildCloudSystemPrompt(
        null,
      );
      expect(prompt).toContain("stop with local changes ready for review");
    });

    it.each([
      {
        label: "createPr unset",
        config: { repositoryPath: undefined },
        shouldContain: [
          "Cloud Task Execution — No Repository Mode",
          "Clone the repository into /tmp/workspace/repos/<owner>/<repo>",
          "gh repo clone <owner>/<repo> /tmp/workspace/repos/<owner>/<repo>",
          "If the user explicitly asks you to open or update a pull request",
          "open a draft pull request",
          "unless the user explicitly asks",
          ".github/pull_request_template.md",
          "gh issue list --search",
          "Closes #<n>",
          "Generated-By: PostHog Code",
          "Task-Id: test-task-id",
        ],
        shouldNotContain: [],
      },
      {
        label: "createPr false",
        config: { repositoryPath: undefined, createPr: false },
        shouldContain: [
          "Cloud Task Execution — No Repository Mode",
          "You may clone a repository and make local edits in that clone",
          "Do NOT create branches, commits, push changes, or open pull requests in this run",
        ],
        shouldNotContain: ["open a draft pull request", "gh pr create --draft"],
      },
    ])(
      "returns no-repository prompt for $label",
      ({ config, shouldContain, shouldNotContain }) => {
        const s = createServer(config);
        const prompt = (
          s as unknown as TestableServer
        ).buildCloudSystemPrompt();

        for (const text of shouldContain) {
          expect(prompt).toContain(text);
        }
        for (const text of shouldNotContain) {
          expect(prompt).not.toContain(text);
        }
      },
    );

    it("returns auto-PR prompt for Slack-origin runs", () => {
      process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
      const s = createServer();
      const prompt = (s as unknown as TestableServer).buildCloudSystemPrompt();
      expect(prompt).toContain("posthog-code/");
      expect(prompt).toContain("Create a draft pull request");
      expect(prompt).toContain("gh pr create --draft");
      expect(prompt).toContain("Generated-By: PostHog Code");
      expect(prompt).toContain("Task-Id: test-task-id");
      // Slack-origin PRs are attributed to PostHog, not the PostHog Code app.
      expect(prompt).toContain(
        "Created with [PostHog](https://posthog.com?ref=pr)",
      );
      // PR template detection (repo first, org `.github` fallback)
      expect(prompt).toContain(".github/pull_request_template.md");
      expect(prompt).toContain("org's `.github` repo");
      // Related-issue linking
      expect(prompt).toContain("gh issue list --state open --search");
      expect(prompt).toContain("Closes #<n>");
      expect(prompt).toContain("Refs #<n>");
      delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
    });

    it("returns auto-PR prompt for signal_report-origin runs", () => {
      process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "signal_report";
      const s = createServer();
      const prompt = (s as unknown as TestableServer).buildCloudSystemPrompt();
      expect(prompt).toContain("posthog-code/");
      expect(prompt).toContain("Create a draft pull request");
      expect(prompt).toContain("gh pr create --draft");
      delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
    });

    it.each([
      { label: "Slack", origin: "slack" },
      { label: "signal_report", origin: "signal_report" },
    ])(
      "guards the auto-PR prompt against duplicating an existing PR on $label-origin runs",
      ({ origin }) => {
        process.env.POSTHOG_CODE_INTERACTION_ORIGIN = origin;
        const s = createServer();
        const prompt = (
          s as unknown as TestableServer
        ).buildCloudSystemPrompt();
        // Still the new-PR branch...
        expect(prompt).toContain("gh pr create --draft");
        // ...but tells the agent to continue an existing linked PR instead of duplicating.
        expect(prompt).toContain("implementation_pr_url");
        expect(prompt).toContain("gh pr checkout <url>");
        expect(prompt).toMatch(/do not open a second PR/i);
        delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
      },
    );

    it("returns PR-update prompt for existing PRs on Slack-origin runs", () => {
      process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
      const s = createServer();
      const prompt = (s as unknown as TestableServer).buildCloudSystemPrompt(
        "https://github.com/org/repo/pull/1",
      );
      expect(prompt).toContain(
        "gh pr checkout https://github.com/org/repo/pull/1",
      );
      expect(prompt).toContain("git_signed_commit");
      expect(prompt).toContain("Committing (signed commits required)");
      expect(prompt).not.toContain("Create a draft pull request");
      // Review-comment thread handling: reply + resolve
      expect(prompt).toContain("review thread");
      expect(prompt).toContain("/pulls/{n}/comments/{id}/replies");
      expect(prompt).toContain("resolveReviewThread");
      expect(prompt).toContain(
        "Do NOT push fixes for review comments without replying to and resolving each related thread.",
      );
      delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
    });

    it("includes --base flag when baseBranch is configured", () => {
      process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
      server = new AgentServer({
        port,
        jwtPublicKey: TEST_PUBLIC_KEY,
        repositoryPath: repo.path,
        apiUrl: "http://localhost:8000",
        apiKey: "test-api-key",
        projectId: 1,
        mode: "interactive",
        taskId: "test-task-id",
        runId: "test-run-id",
        baseBranch: "add-yolo-to-readme",
      });
      const prompt = (
        server as unknown as TestableServer
      ).buildCloudSystemPrompt();
      expect(prompt).toContain(
        "gh pr create --draft --base add-yolo-to-readme",
      );
      delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
    });

    it("omits --base flag when baseBranch is not configured", () => {
      process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
      const s = createServer();
      const prompt = (s as unknown as TestableServer).buildCloudSystemPrompt();
      expect(prompt).toContain("gh pr create --draft`");
      expect(prompt).not.toContain("--base");
      delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
    });

    it("disables auto-publish for Slack-origin runs when createPr is false", () => {
      process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
      server = new AgentServer({
        port,
        jwtPublicKey: TEST_PUBLIC_KEY,
        repositoryPath: repo.path,
        apiUrl: "http://localhost:8000",
        apiKey: "test-api-key",
        projectId: 1,
        mode: "interactive",
        taskId: "test-task-id",
        runId: "test-run-id",
        createPr: false,
      });
      const prompt = (
        server as unknown as TestableServer
      ).buildCloudSystemPrompt();
      expect(prompt).toContain("stop with local changes ready for review");
      expect(prompt).not.toContain("gh pr create --draft");
      delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
    });

    it("disables auto-publish for existing PRs when createPr is false", () => {
      process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
      server = new AgentServer({
        port,
        jwtPublicKey: TEST_PUBLIC_KEY,
        repositoryPath: repo.path,
        apiUrl: "http://localhost:8000",
        apiKey: "test-api-key",
        projectId: 1,
        mode: "interactive",
        taskId: "test-task-id",
        runId: "test-run-id",
        createPr: false,
      });
      const prompt = (
        server as unknown as TestableServer
      ).buildCloudSystemPrompt("https://github.com/org/repo/pull/1");
      expect(prompt).toContain("stop with local changes ready for review");
      expect(prompt).not.toContain("gh pr checkout");
      expect(prompt).not.toContain("Push to the existing PR branch");
      delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
    });

    describe("identity instructions", () => {
      it.each([
        {
          label: "no repository, no PR",
          config: { repositoryPath: undefined },
        },
        { label: "repository, no PR", config: {} },
      ])(
        "injects PostHog Slack app identity for Slack-origin runs ($label)",
        ({ config }) => {
          process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
          const s = createServer(config);
          const prompt = (
            s as unknown as TestableServer
          ).buildCloudSystemPrompt();
          expect(prompt).toContain("# Identity");
          expect(prompt).toContain("PostHog Slack app");
          expect(prompt).toContain("Do NOT refer to yourself as Claude");
          delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
        },
      );

      it.each([
        {
          label: "no repository, no PR",
          config: { repositoryPath: undefined },
        },
        { label: "repository, no PR", config: {} },
      ])(
        "injects concise response-style guidance for Slack-origin runs ($label)",
        ({ config }) => {
          process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
          const s = createServer(config);
          const prompt = (
            s as unknown as TestableServer
          ).buildCloudSystemPrompt();
          expect(prompt).toContain("# Response Style");
          expect(prompt).toContain("be concise by default");
          expect(prompt).toContain(
            "Answer simple questions in a single sentence",
          );
          delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
        },
      );

      it.each([
        { label: "no origin set", origin: undefined },
        { label: "signal_report origin", origin: "signal_report" },
        { label: "posthog_code origin", origin: "posthog_code" },
      ])(
        "omits response-style guidance for non-Slack runs ($label)",
        ({ origin }) => {
          if (origin) {
            process.env.POSTHOG_CODE_INTERACTION_ORIGIN = origin;
          } else {
            delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
          }
          const s = createServer();
          const prompt = (
            s as unknown as TestableServer
          ).buildCloudSystemPrompt();
          expect(prompt).not.toContain("# Response Style");
          delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
        },
      );

      it("injects identity for Slack-origin runs with an existing PR", () => {
        process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
        const s = createServer();
        const prompt = (s as unknown as TestableServer).buildCloudSystemPrompt(
          "https://github.com/org/repo/pull/1",
        );
        expect(prompt).toContain("# Identity");
        expect(prompt).toContain("PostHog Slack app");
        delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
      });

      it.each([
        { label: "no origin set", origin: undefined },
        { label: "signal_report origin", origin: "signal_report" },
        { label: "posthog_code origin", origin: "posthog_code" },
      ])("omits identity block for non-Slack runs ($label)", ({ origin }) => {
        if (origin) {
          process.env.POSTHOG_CODE_INTERACTION_ORIGIN = origin;
        } else {
          delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
        }
        const s = createServer();
        const prompt = (
          s as unknown as TestableServer
        ).buildCloudSystemPrompt();
        expect(prompt).not.toContain("# Identity");
        expect(prompt).not.toContain("PostHog Slack app");
        delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
      });
    });

    describe("PR body guidance (why context + brevity + footer)", () => {
      it("instructs Why, brevity, and the plain footer (no Slack link) when auto-creating a Slack PR without a thread URL", () => {
        process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
        try {
          const prompt = (
            createServer() as unknown as TestableServer
          ).buildCloudSystemPrompt();
          expect(prompt).toContain("gh pr create --draft");
          // why context
          expect(prompt).toContain("**Why**");
          expect(prompt).toContain("the reason the user asked for this change");
          // brevity
          expect(prompt).toContain("Keep the PR description brief");
          expect(prompt).toContain("do NOT enumerate every change");
          // plain footer, no Slack link; Slack-origin PRs are branded "PostHog"
          expect(prompt).toContain(
            "*Created with [PostHog](https://posthog.com?ref=pr)*",
          );
          expect(prompt).not.toContain("from a [Slack thread]");
          expect(prompt).not.toContain("PostHog Code](https://posthog.com");
        } finally {
          delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
        }
      });

      it("embeds the Slack thread link in the footer when one is available", () => {
        process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
        try {
          const prompt = (
            createServer() as unknown as TestableServer
          ).buildCloudSystemPrompt(
            null,
            "https://posthog.slack.com/archives/C123/p456",
          );
          expect(prompt).toContain(
            "*Created with [PostHog](https://posthog.com?ref=pr) from a [Slack thread](https://posthog.slack.com/archives/C123/p456)*",
          );
          // The Why bullet no longer carries the thread link.
          expect(prompt).not.toContain(
            "this task started from a Slack thread, also link it",
          );
        } finally {
          delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
        }
      });

      it("embeds the inbox report link in the footer for a signal_report run", () => {
        process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "signal_report";
        try {
          const prompt = (
            createServer() as unknown as TestableServer
          ).buildCloudSystemPrompt(
            null,
            null,
            "http://localhost:8000/project/1/inbox/rep_1",
          );
          expect(prompt).toContain(
            "*Created with [PostHog](https://posthog.com?ref=pr) from an [inbox report](http://localhost:8000/project/1/inbox/rep_1)*",
          );
          expect(prompt).not.toContain("from a [Slack thread]");
        } finally {
          delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
        }
      });

      it("prefers the Slack thread link over the inbox report link when both are present", () => {
        process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
        try {
          const prompt = (
            createServer() as unknown as TestableServer
          ).buildCloudSystemPrompt(
            null,
            "https://posthog.slack.com/archives/C123/p456",
            "http://localhost:8000/project/1/inbox/rep_1",
          );
          expect(prompt).toContain("from a [Slack thread]");
          expect(prompt).not.toContain("from an [inbox report]");
        } finally {
          delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
        }
      });

      it("instructs Why, brevity, and the plain footer on the non-Slack no-repository path", () => {
        delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
        const prompt = (
          createServer({
            repositoryPath: undefined,
          }) as unknown as TestableServer
        ).buildCloudSystemPrompt();
        expect(prompt).toContain("open a draft pull request");
        expect(prompt).toContain("**Why**");
        expect(prompt).toContain("Keep the PR description brief");
        expect(prompt).toContain(
          "*Created with [PostHog Code](https://posthog.com/code?ref=pr)*",
        );
        expect(prompt).not.toContain("from a [Slack thread]");
      });

      it("embeds the Slack thread link in the footer on the no-repository path when one is available", () => {
        process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
        try {
          const prompt = (
            createServer({
              repositoryPath: undefined,
            }) as unknown as TestableServer
          ).buildCloudSystemPrompt(
            null,
            "https://posthog.slack.com/archives/C123/p456",
          );
          expect(prompt).toContain(
            "*Created with [PostHog](https://posthog.com?ref=pr) from a [Slack thread](https://posthog.slack.com/archives/C123/p456)*",
          );
        } finally {
          delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
        }
      });
    });
  });

  describe("buildDetectedPrContext", () => {
    const prUrl = "https://github.com/org/repo/pull/1";

    it("returns review-first PR context for non-Slack runs", () => {
      const s = createServer();
      const context = (s as unknown as TestableServer).buildDetectedPrContext(
        prUrl,
      );
      expect(context).toContain("stop with local changes ready for review");
      expect(context).toContain(
        "Do NOT create commits, push to the PR branch, update the pull request",
      );
      expect(context).not.toContain("gh pr checkout");
    });

    it("returns auto-update PR context for Slack-origin runs", () => {
      process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
      const s = createServer();
      const context = (s as unknown as TestableServer).buildDetectedPrContext(
        prUrl,
      );
      expect(context).toContain(`gh pr checkout ${prUrl}`);
      expect(context).toContain(
        "Make changes, commit, and push to that branch",
      );
      delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
    });

    it("returns review-first PR context when createPr is false", () => {
      process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
      server = new AgentServer({
        port,
        jwtPublicKey: TEST_PUBLIC_KEY,
        repositoryPath: repo.path,
        apiUrl: "http://localhost:8000",
        apiKey: "test-api-key",
        projectId: 1,
        mode: "interactive",
        taskId: "test-task-id",
        runId: "test-run-id",
        createPr: false,
      });
      const context = (
        server as unknown as TestableServer
      ).buildDetectedPrContext(prUrl);
      expect(context).toContain("stop with local changes ready for review");
      expect(context).not.toContain("gh pr checkout");
      delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
    });
  });
});
