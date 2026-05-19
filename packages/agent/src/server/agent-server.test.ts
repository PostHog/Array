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
import { createTestRepo, type TestRepo } from "../test/fixtures/api";
import { createPostHogHandlers } from "../test/mocks/msw-handlers";
import type { TaskRun } from "../types";
import { AgentServer, SSE_KEEPALIVE_INTERVAL_MS } from "./agent-server";
import { type JwtPayload, SANDBOX_CONNECTION_AUDIENCE } from "./jwt";

interface TestableServer {
  getInitialPromptOverride(run: TaskRun): string | null;
  getClearedPendingUserState(run: TaskRun | null): string[] | null;
  clearPendingInitialPromptState(
    payload: JwtPayload,
    run: TaskRun | null,
  ): Promise<void>;
  detectAndAttachPrUrl(payload: unknown, update: unknown): void;
  detectedPrUrl: string | null;
  buildCloudSystemPrompt(prUrl?: string | null): string;
  buildDetectedPrContext(prUrl: string): string;
  buildSessionSystemPrompt(prUrl?: string | null): string | { append: string };
  buildCodexInstructions(systemPrompt: string | { append: string }): string;
  getRuntimeAdapter(): "claude" | "codex";
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
      expect(body).toEqual({ status: "ok", hasSession: true });
    }, 30000);
  });

  describe("turn completion", () => {
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

  describe("detectedPrUrl tracking", () => {
    it("stores PR URL when gh pr create produces it", () => {
      const s = createServer();
      const payload = {
        task_id: "test-task-id",
        run_id: "test-run-id",
      };
      const update = {
        _meta: {
          claudeCode: {
            toolName: "Bash",
            bashCommand: 'gh pr create --title "x" --body "y"',
            toolResponse: {
              stdout:
                "https://github.com/PostHog/posthog/pull/42\nCreating pull request...",
            },
          },
        },
      };

      (s as unknown as TestableServer).detectAndAttachPrUrl(payload, update);
      expect((s as unknown as TestableServer).detectedPrUrl).toBe(
        "https://github.com/PostHog/posthog/pull/42",
      );
    });

    it("does not set detectedPrUrl when no PR URL is found", () => {
      const s = createServer();
      const payload = {
        task_id: "test-task-id",
        run_id: "test-run-id",
      };
      const update = {
        _meta: {
          claudeCode: {
            toolName: "Bash",
            bashCommand: "gh pr create",
            toolResponse: { stdout: "just some output" },
          },
        },
      };

      (s as unknown as TestableServer).detectAndAttachPrUrl(payload, update);
      expect((s as unknown as TestableServer).detectedPrUrl).toBeNull();
    });

    it("does not attach PR URL when the bash command is gh pr view", () => {
      const s = createServer();
      const payload = {
        task_id: "test-task-id",
        run_id: "test-run-id",
      };
      const update = {
        _meta: {
          claudeCode: {
            toolName: "Bash",
            bashCommand: "gh pr view 42 --json url",
            toolResponse: {
              stdout: "https://github.com/PostHog/posthog/pull/42",
            },
          },
        },
      };

      (s as unknown as TestableServer).detectAndAttachPrUrl(payload, update);
      expect((s as unknown as TestableServer).detectedPrUrl).toBeNull();
    });

    it("does not attach PR URL when the bash command is gh search prs", () => {
      const s = createServer();
      const payload = {
        task_id: "test-task-id",
        run_id: "test-run-id",
      };
      const update = {
        _meta: {
          claudeCode: {
            toolName: "Bash",
            bashCommand: 'gh search prs "fix login"',
            toolResponse: {
              stdout: "https://github.com/PostHog/posthog/pull/42",
            },
          },
        },
      };

      (s as unknown as TestableServer).detectAndAttachPrUrl(payload, update);
      expect((s as unknown as TestableServer).detectedPrUrl).toBeNull();
    });

    it("does not attach PR URL when bashCommand is missing", () => {
      const s = createServer();
      const payload = {
        task_id: "test-task-id",
        run_id: "test-run-id",
      };
      const update = {
        _meta: {
          claudeCode: {
            toolName: "Bash",
            toolResponse: {
              stdout: "https://github.com/PostHog/posthog/pull/42",
            },
          },
        },
      };

      (s as unknown as TestableServer).detectAndAttachPrUrl(payload, update);
      expect((s as unknown as TestableServer).detectedPrUrl).toBeNull();
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
      expect(prompt).toContain("Created with [PostHog Code]");
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

    it("returns PR-update prompt for existing PRs on Slack-origin runs", () => {
      process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
      const s = createServer();
      const prompt = (s as unknown as TestableServer).buildCloudSystemPrompt(
        "https://github.com/org/repo/pull/1",
      );
      expect(prompt).toContain(
        "gh pr checkout https://github.com/org/repo/pull/1",
      );
      expect(prompt).toContain(
        "Stage and commit all changes with a clear commit message",
      );
      expect(prompt).toContain("Push to the existing PR branch");
      expect(prompt).not.toContain("Create a draft pull request");
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
