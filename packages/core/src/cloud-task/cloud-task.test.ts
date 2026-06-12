import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudTaskEvent } from "./schemas";

const mockNetFetch = vi.hoisted(() => vi.fn());
const mockStreamFetch = vi.hoisted(() => vi.fn());
const mockStreamTokenFetch = vi.hoisted(() => vi.fn());

// The service now uses global fetch for BOTH authenticated API calls (JSON)
// and SSE streaming. The two used to be distinct (net.fetch vs global fetch).
// Route by URL: /stream_token/ → token mock (read-leg resolution), the stream leg
// (Django /stream/ or proxy /v1/runs/:run/stream) → stream mock, everything else → API mock.
// The token mock has a Django-path default so existing fixtures (which never set it) are untouched.
const fetchRouter = vi.hoisted(() =>
  vi.fn((input: string | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    const impl = url.includes("/stream_token/")
      ? mockStreamTokenFetch
      : /\/stream(\/|\?|$)/.test(url)
        ? mockStreamFetch
        : mockNetFetch;
    return impl(input, init);
  }),
);

import { CloudTaskService } from "./cloud-task";

const mockAuthService = {
  authenticatedFetch: vi.fn(),
};

function createJsonResponse(
  data: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
  });
}

function createSseResponse(payload: string, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function createOpenSseResponse(payload: string, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
    },
  });

  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(10);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

describe("CloudTaskService", () => {
  let service: CloudTaskService;

  beforeEach(() => {
    const scopedLog = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const loggerMock = { ...scopedLog, scope: vi.fn(() => scopedLog) };
    const analyticsMock = { track: vi.fn() };
    service = new CloudTaskService(
      mockAuthService as never,
      analyticsMock as never,
      loggerMock,
    );
    mockNetFetch.mockReset();
    mockStreamFetch.mockReset();
    mockStreamTokenFetch.mockReset();
    // Default read-leg resolution: no proxy URL, so the stream reads from Django directly.
    mockStreamTokenFetch.mockImplementation(() =>
      Promise.resolve(
        createJsonResponse({ token: "test-token", stream_base_url: null }),
      ),
    );
    mockAuthService.authenticatedFetch.mockReset();
    vi.stubGlobal("fetch", fetchRouter);

    mockAuthService.authenticatedFetch.mockImplementation(
      async (input: string | Request, init?: RequestInit) => {
        return fetchRouter(input, {
          ...init,
          headers: {
            ...(init?.headers ?? {}),
            Authorization: "Bearer token",
          },
        });
      },
    );
  });

  afterEach(() => {
    service.unwatchAll();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("bootstraps paged backlog for active runs and drains deduped live SSE entries", async () => {
    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    mockNetFetch
      .mockResolvedValueOnce(
        createJsonResponse({
          id: "run-1",
          status: "in_progress",
          stage: "build",
          output: null,
          error_message: null,
          branch: "main",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse(
          [
            {
              type: "notification",
              timestamp: "2026-01-01T00:00:00Z",
              notification: {
                jsonrpc: "2.0",
                method: "_posthog/console",
                params: {
                  sessionId: "run-1",
                  level: "info",
                  message: "older history",
                },
              },
            },
          ],
          200,
          { "X-Has-More": "true" },
        ),
      )
      .mockResolvedValueOnce(
        createJsonResponse(
          [
            {
              type: "notification",
              timestamp: "2026-01-01T00:00:01Z",
              notification: {
                jsonrpc: "2.0",
                method: "_posthog/console",
                params: {
                  sessionId: "run-1",
                  level: "info",
                  message: "hello",
                },
              },
            },
          ],
          200,
          { "X-Has-More": "false" },
        ),
      );

    mockStreamFetch.mockResolvedValueOnce(
      createOpenSseResponse(
        'id: 1\ndata: {"type":"notification","timestamp":"2026-01-01T00:00:01Z","notification":{"jsonrpc":"2.0","method":"_posthog/console","params":{"sessionId":"run-1","level":"info","message":"hello"}}}\n\nid: 2\ndata: {"type":"notification","timestamp":"2026-01-01T00:00:02Z","notification":{"jsonrpc":"2.0","method":"_posthog/console","params":{"sessionId":"run-1","level":"info","message":"live tail"}}}\n\n',
      ),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => updates.length >= 2);

    expect(updates).toEqual([
      {
        taskId: "task-1",
        runId: "run-1",
        kind: "snapshot",
        newEntries: [
          {
            type: "notification",
            timestamp: "2026-01-01T00:00:00Z",
            notification: {
              jsonrpc: "2.0",
              method: "_posthog/console",
              params: {
                sessionId: "run-1",
                level: "info",
                message: "older history",
              },
            },
          },
          {
            type: "notification",
            timestamp: "2026-01-01T00:00:01Z",
            notification: {
              jsonrpc: "2.0",
              method: "_posthog/console",
              params: {
                sessionId: "run-1",
                level: "info",
                message: "hello",
              },
            },
          },
        ],
        totalEntryCount: 2,
        status: "in_progress",
        stage: "build",
        output: null,
        errorMessage: null,
        branch: "main",
      },
      {
        taskId: "task-1",
        runId: "run-1",
        kind: "logs",
        newEntries: [
          {
            type: "notification",
            timestamp: "2026-01-01T00:00:02Z",
            notification: {
              jsonrpc: "2.0",
              method: "_posthog/console",
              params: {
                sessionId: "run-1",
                level: "info",
                message: "live tail",
              },
            },
          },
        ],
        totalEntryCount: 3,
      },
    ]);

    expect(mockStreamFetch).toHaveBeenCalledWith(
      "https://app.example.com/api/projects/2/tasks/task-1/runs/run-1/stream/?start=latest",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          Accept: "text/event-stream",
        }),
      }),
    );
  });

  it("reconnects with Last-Event-ID after a stream error", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    mockNetFetch
      .mockResolvedValueOnce(
        createJsonResponse({
          id: "run-1",
          status: "in_progress",
          stage: null,
          output: null,
          error_message: null,
          branch: "main",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse([], 200, { "X-Has-More": "false" }),
      );

    mockStreamFetch
      .mockResolvedValueOnce(
        createSseResponse(
          'id: 1\ndata: {"type":"notification","timestamp":"2026-01-01T00:00:01Z","notification":{"jsonrpc":"2.0","method":"_posthog/console","params":{"sessionId":"run-1","level":"info","message":"hello"}}}\n\nevent: error\ndata: {"error":"boom"}\n\n',
        ),
      )
      .mockResolvedValueOnce(
        createOpenSseResponse(
          'id: 2\ndata: {"type":"notification","timestamp":"2026-01-01T00:00:02Z","notification":{"jsonrpc":"2.0","method":"_posthog/console","params":{"sessionId":"run-1","level":"info","message":"again"}}}\n\n',
        ),
      );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await waitFor(() => updates.length >= 2);

    expect(mockStreamFetch).toHaveBeenNthCalledWith(
      2,
      "https://app.example.com/api/projects/2/tasks/task-1/runs/run-1/stream/",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          Accept: "text/event-stream",
          "Last-Event-ID": "1",
        }),
      }),
    );
  });

  it("replays a current snapshot when a subscriber attaches to an existing watcher", async () => {
    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    const historicalEntry = {
      type: "notification",
      timestamp: "2026-01-01T00:00:00Z",
      notification: {
        jsonrpc: "2.0",
        method: "_posthog/console",
        params: {
          sessionId: "run-1",
          level: "info",
          message: "older history",
        },
      },
    };
    const liveEntry = {
      type: "notification",
      timestamp: "2026-01-01T00:00:01Z",
      notification: {
        jsonrpc: "2.0",
        method: "_posthog/console",
        params: {
          sessionId: "run-1",
          level: "info",
          message: "live tail",
        },
      },
    };

    const runResponse = {
      id: "run-1",
      status: "in_progress",
      stage: "build",
      output: null,
      error_message: null,
      branch: "main",
      updated_at: "2026-01-01T00:00:00Z",
    };

    mockNetFetch
      .mockResolvedValueOnce(createJsonResponse(runResponse))
      .mockResolvedValueOnce(
        createJsonResponse([historicalEntry], 200, { "X-Has-More": "false" }),
      )
      .mockResolvedValueOnce(createJsonResponse(runResponse))
      .mockResolvedValueOnce(
        createJsonResponse([historicalEntry], 200, { "X-Has-More": "false" }),
      );

    mockStreamFetch.mockResolvedValueOnce(
      createOpenSseResponse(`id: 1\ndata: ${JSON.stringify(liveEntry)}\n\n`),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => updates.length >= 2);

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() =>
      updates.some(
        (update) =>
          typeof update === "object" &&
          update !== null &&
          (update as { kind?: string; totalEntryCount?: number }).kind ===
            "snapshot" &&
          (update as { totalEntryCount?: number }).totalEntryCount === 2,
      ),
    );

    const replayedSnapshot = updates.find(
      (update) =>
        typeof update === "object" &&
        update !== null &&
        (update as { kind?: string; totalEntryCount?: number }).kind ===
          "snapshot" &&
        (update as { totalEntryCount?: number }).totalEntryCount === 2,
    );

    expect(replayedSnapshot).toEqual({
      taskId: "task-1",
      runId: "run-1",
      kind: "snapshot",
      newEntries: [historicalEntry, liveEntry],
      totalEntryCount: 2,
      status: "in_progress",
      stage: "build",
      output: null,
      errorMessage: null,
      branch: "main",
    });

    const getWatcherEmittedEntryCount = (): number => {
      const watcher = (
        service as unknown as {
          watchers: Map<string, { emittedLogEntries: unknown[] }>;
        }
      ).watchers.get("task-1:run-1");
      return watcher?.emittedLogEntries.length ?? 0;
    };

    expect(getWatcherEmittedEntryCount()).toBe(1);

    mockNetFetch.mockResolvedValueOnce(
      createJsonResponse([historicalEntry, liveEntry], 200, {
        "X-Has-More": "false",
      }),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => getWatcherEmittedEntryCount() === 0);
  });

  it("ignores keepalive SSE events while keeping the stream open", async () => {
    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    mockNetFetch
      .mockResolvedValueOnce(
        createJsonResponse({
          id: "run-1",
          status: "in_progress",
          stage: "build",
          output: null,
          error_message: null,
          branch: "main",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse([], 200, { "X-Has-More": "false" }),
      );

    mockStreamFetch.mockResolvedValueOnce(
      createOpenSseResponse(
        'event: keepalive\ndata: {"type":"keepalive"}\n\nid: 2\ndata: {"type":"notification","timestamp":"2026-01-01T00:00:02Z","notification":{"jsonrpc":"2.0","method":"_posthog/console","params":{"sessionId":"run-1","level":"info","message":"live tail"}}}\n\n',
      ),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => updates.length >= 2);

    expect(updates).toEqual([
      {
        taskId: "task-1",
        runId: "run-1",
        kind: "snapshot",
        newEntries: [],
        totalEntryCount: 0,
        status: "in_progress",
        stage: "build",
        output: null,
        errorMessage: null,
        branch: "main",
      },
      {
        taskId: "task-1",
        runId: "run-1",
        kind: "logs",
        newEntries: [
          {
            type: "notification",
            timestamp: "2026-01-01T00:00:02Z",
            notification: {
              jsonrpc: "2.0",
              method: "_posthog/console",
              params: {
                sessionId: "run-1",
                level: "info",
                message: "live tail",
              },
            },
          },
        ],
        totalEntryCount: 1,
      },
    ]);
  });

  it("reconnects after clean stream completion when the run remains active", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    const prUrl = "https://github.com/PostHog/code/pull/123";
    let statusFetchCount = 0;
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    const createInProgressRun = (output: Record<string, unknown> | null) =>
      createJsonResponse({
        id: "run-1",
        status: "in_progress",
        stage: "build",
        output,
        error_message: null,
        branch: "main",
        updated_at: output ? "2026-01-01T00:00:01Z" : "2026-01-01T00:00:00Z",
      });

    mockNetFetch.mockImplementation((input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/session_logs/")) {
        return Promise.resolve(
          createJsonResponse([], 200, { "X-Has-More": "false" }),
        );
      }

      statusFetchCount += 1;
      return Promise.resolve(
        createInProgressRun(statusFetchCount === 1 ? null : { pr_url: prUrl }),
      );
    });

    mockStreamFetch.mockImplementation(() =>
      Promise.resolve(createSseResponse("")),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => mockStreamFetch.mock.calls.length === 1);
    await waitFor(() => mockStreamFetch.mock.calls.length >= 7, 20_000);

    expect(updates).toContainEqual(
      expect.objectContaining({
        taskId: "task-1",
        runId: "run-1",
        status: "in_progress",
        output: { pr_url: prUrl },
      }),
    );
    expect(
      updates.some(
        (update) =>
          typeof update === "object" &&
          update !== null &&
          (update as { kind?: string }).kind === "error",
      ),
    ).toBe(false);

    expect(
      (
        service as unknown as {
          watchers: Map<string, unknown>;
        }
      ).watchers.has("task-1:run-1"),
    ).toBe(true);
  });

  it("stops without reconnecting when the server emits stream-end on a non-terminal run", async () => {
    vi.useFakeTimers();

    // Run status stays non-terminal the whole time. Pre-durable-contract, a clean EOF on a
    // non-terminal run reconnects (see the test above); the stream-end sentinel must override that.
    mockNetFetch.mockImplementation((input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/session_logs/")) {
        return Promise.resolve(
          createJsonResponse([], 200, { "X-Has-More": "false" }),
        );
      }
      return Promise.resolve(
        createJsonResponse({
          id: "run-1",
          status: "in_progress",
          stage: "build",
          output: null,
          error_message: null,
          branch: "main",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      );
    });

    mockStreamFetch.mockImplementation(() =>
      Promise.resolve(
        createSseResponse(
          'id: 1\ndata: {"type":"notification","timestamp":"2026-01-01T00:00:01Z","notification":{"jsonrpc":"2.0","method":"_posthog/console","params":{"sessionId":"run-1","level":"info","message":"hi"}}}\n\nevent: stream-end\ndata: {}\n\n',
        ),
      ),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    const hasWatcher = (): boolean =>
      (service as unknown as { watchers: Map<string, unknown> }).watchers.has(
        "task-1:run-1",
      );

    await waitFor(() => mockStreamFetch.mock.calls.length === 1);
    // Let the reconnect delay (2s base) elapse; with stream-end honored, none is scheduled.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockStreamFetch.mock.calls.length).toBe(1);
    await waitFor(() => !hasWatcher());
  });

  it("emits the bootstrap snapshot when stream-end arrives mid-bootstrap", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    const historicalEntry = {
      type: "notification",
      timestamp: "2026-01-01T00:00:01Z",
      notification: {
        jsonrpc: "2.0",
        method: "_posthog/console",
        params: { sessionId: "run-1", level: "info", message: "backlog" },
      },
    };

    // Hold the session_logs fetch open until the stream has already delivered
    // stream-end and closed, so completion races the bootstrap snapshot.
    let releaseSessionLogs: (() => void) | undefined;
    const sessionLogsGate = new Promise<void>((resolve) => {
      releaseSessionLogs = resolve;
    });

    mockNetFetch.mockImplementation(async (input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/session_logs/")) {
        await sessionLogsGate;
        return createJsonResponse([historicalEntry], 200, {
          "X-Has-More": "false",
        });
      }
      return createJsonResponse({
        id: "run-1",
        status: "in_progress",
        stage: "build",
        output: null,
        error_message: null,
        branch: "main",
        updated_at: "2026-01-01T00:00:00Z",
      });
    });

    mockStreamFetch.mockImplementation(() =>
      Promise.resolve(createSseResponse("event: stream-end\ndata: {}\n\n")),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    // Stream connects, delivers stream-end and EOFs while session_logs hangs.
    await waitFor(() => mockStreamFetch.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(1_000);

    releaseSessionLogs?.();

    const hasWatcher = (): boolean =>
      (service as unknown as { watchers: Map<string, unknown> }).watchers.has(
        "task-1:run-1",
      );
    await waitFor(() => !hasWatcher());

    const snapshots = updates.filter(
      (u) =>
        typeof u === "object" &&
        u !== null &&
        (u as { kind?: string }).kind === "snapshot",
    );
    expect(snapshots).toHaveLength(1);
    expect(
      (snapshots[0] as { newEntries: unknown[] }).newEntries,
    ).toContainEqual(historicalEntry);
    // The stream-end stop must not schedule another connection.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockStreamFetch.mock.calls.length).toBe(1);
  });

  it("repairs the final status when stream-end arrives without a terminal state event", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    let runFetchCount = 0;
    mockNetFetch.mockImplementation((input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/session_logs/")) {
        return Promise.resolve(
          createJsonResponse([], 200, { "X-Has-More": "false" }),
        );
      }
      runFetchCount += 1;
      // First fetch bootstraps an active run; the stream then ends without ever
      // carrying a terminal task_run_state event, so the stop path must fetch
      // the completed status itself.
      return Promise.resolve(
        createJsonResponse(
          runFetchCount === 1
            ? {
                id: "run-1",
                status: "in_progress",
                stage: "build",
                output: null,
                error_message: null,
                branch: "main",
                updated_at: "2026-01-01T00:00:00Z",
              }
            : {
                id: "run-1",
                status: "completed",
                stage: null,
                output: { pr_url: "https://github.com/PostHog/code/pull/9" },
                error_message: null,
                branch: "main",
                updated_at: "2026-01-01T00:00:05Z",
              },
        ),
      );
    });

    mockStreamFetch.mockImplementation(() =>
      Promise.resolve(createSseResponse("event: stream-end\ndata: {}\n\n")),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    const hasWatcher = (): boolean =>
      (service as unknown as { watchers: Map<string, unknown> }).watchers.has(
        "task-1:run-1",
      );
    await waitFor(() => !hasWatcher());

    expect(updates).toContainEqual(
      expect.objectContaining({
        kind: "status",
        status: "completed",
        output: { pr_url: "https://github.com/PostHog/code/pull/9" },
      }),
    );
  });

  it("reads via the agent-proxy with a Bearer token when the server resolves a base url", async () => {
    vi.useFakeTimers();

    mockStreamTokenFetch.mockImplementation(() =>
      Promise.resolve(
        createJsonResponse({
          token: "proxy-token",
          stream_base_url: "https://proxy.example",
        }),
      ),
    );

    mockNetFetch.mockImplementation((input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/session_logs/")) {
        return Promise.resolve(
          createJsonResponse([], 200, { "X-Has-More": "false" }),
        );
      }
      return Promise.resolve(
        createJsonResponse({
          id: "run-1",
          status: "in_progress",
          stage: "build",
          output: null,
          error_message: null,
          branch: "main",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      );
    });

    mockStreamFetch.mockImplementation(() =>
      Promise.resolve(createSseResponse("event: stream-end\ndata: {}\n\n")),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => mockStreamFetch.mock.calls.length === 1);

    const [calledUrl, init] = mockStreamFetch.mock.calls[0];
    expect(String(calledUrl)).toMatch(
      /^https:\/\/proxy\.example\/v1\/runs\/run-1\/stream(\?|$)/,
    );
    expect((init?.headers as Record<string, string>)?.Authorization).toBe(
      "Bearer proxy-token",
    );
  });

  it("fails the watcher after exhausting the cumulative reconnect budget on clean-EOF loops", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    const makeInProgressRun = () =>
      createJsonResponse({
        id: "run-1",
        status: "in_progress",
        stage: null,
        output: null,
        error_message: null,
        branch: "main",
        updated_at: "2026-01-01T00:00:00Z",
      });

    mockNetFetch.mockImplementation((input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/session_logs/")) {
        return Promise.resolve(
          createJsonResponse([], 200, { "X-Has-More": "false" }),
        );
      }
      return Promise.resolve(makeInProgressRun());
    });

    mockStreamFetch.mockImplementation(() =>
      Promise.resolve(createSseResponse("")),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => mockStreamFetch.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);

    await waitFor(
      () =>
        updates.some(
          (u) =>
            typeof u === "object" &&
            u !== null &&
            (u as { kind?: string }).kind === "error",
        ),
      10_000,
    );

    expect(updates).toContainEqual({
      taskId: "task-1",
      runId: "run-1",
      kind: "error",
      errorTitle: "Cloud run unreachable",
      errorMessage:
        "Could not maintain a connection to the cloud run after many attempts. Click retry once the issue is resolved.",
      retryable: true,
    });
  });

  it("retry rebuilds the watcher from scratch after a failure", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    mockNetFetch.mockImplementation((input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/session_logs/")) {
        return Promise.resolve(
          createJsonResponse([], 200, { "X-Has-More": "false" }),
        );
      }
      return Promise.resolve(
        createJsonResponse({
          id: "run-1",
          status: "in_progress",
          stage: null,
          output: null,
          error_message: null,
          branch: "main",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      );
    });

    // Every connection records a resume position, then dies on a backend error
    // frame until the error budget fails the watcher.
    mockStreamFetch.mockImplementation(() =>
      Promise.resolve(
        createSseResponse(
          'id: 42\nevent: keepalive\ndata: {"type":"keepalive"}\n\nevent: error\ndata: {"error":"boom"}\n\n',
        ),
      ),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => mockStreamFetch.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(70_000);
    await waitFor(
      () =>
        updates.some(
          (u) =>
            typeof u === "object" &&
            u !== null &&
            (u as { kind?: string }).kind === "error",
        ),
      10_000,
    );

    const countSnapshots = (): number =>
      updates.filter(
        (u) =>
          typeof u === "object" &&
          u !== null &&
          (u as { kind?: string }).kind === "snapshot",
      ).length;
    const tokenCallsBeforeRetry = mockStreamTokenFetch.mock.calls.length;
    const snapshotsBeforeRetry = countSnapshots();
    const streamCallsBeforeRetry = mockStreamFetch.mock.calls.length;

    mockStreamFetch.mockImplementation(() =>
      Promise.resolve(
        createOpenSseResponse(
          'event: keepalive\ndata: {"type":"keepalive"}\n\n',
        ),
      ),
    );

    service.retry("task-1", "run-1");

    await waitFor(
      () => mockStreamFetch.mock.calls.length === streamCallsBeforeRetry + 1,
    );
    await waitFor(() => countSnapshots() === snapshotsBeforeRetry + 1);

    // Retry must rebuild from server truth: re-resolve the read leg, re-emit a
    // fresh snapshot and drop the poisoned resume position instead of resuming
    // from the failed stream's Last-Event-ID.
    expect(mockStreamTokenFetch.mock.calls.length).toBe(
      tokenCallsBeforeRetry + 1,
    );
    const [, init] = mockStreamFetch.mock.calls[streamCallsBeforeRetry];
    expect(
      (init?.headers as Record<string, string>)?.["Last-Event-ID"],
    ).toBeUndefined();
  });

  it("emits a retryable cloud error after repeated stream failures", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    const makeInProgressRun = () =>
      createJsonResponse({
        id: "run-1",
        status: "in_progress",
        stage: null,
        output: null,
        error_message: null,
        branch: "main",
        updated_at: "2026-01-01T00:00:00Z",
      });

    mockNetFetch
      .mockResolvedValueOnce(makeInProgressRun()) // bootstrap: fetchTaskRun
      .mockResolvedValueOnce(
        createJsonResponse([], 200, { "X-Has-More": "false" }),
      ) // bootstrap: fetchSessionLogs
      // Each stream error triggers handleStreamCompletion → fetchTaskRun
      .mockImplementation(() => Promise.resolve(makeInProgressRun()));

    mockStreamFetch.mockImplementation(() =>
      Promise.resolve(
        createSseResponse(
          'event: keepalive\ndata: {"type":"keepalive"}\n\nevent: error\ndata: {"error":"boom"}\n\n',
        ),
      ),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => mockStreamFetch.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(70_000);
    await waitFor(
      () =>
        updates.some(
          (u) =>
            typeof u === "object" &&
            u !== null &&
            (u as { kind?: string }).kind === "error",
        ),
      10_000,
    );

    expect(mockStreamFetch.mock.calls.length).toBe(10);
    // Status is no longer polled per reconnect. Only the 2 bootstrap calls plus the single
    // post-bootstrap verification touch the status endpoint; reconnects never do.
    expect(mockNetFetch.mock.calls.length).toBeLessThanOrEqual(3);
    expect(updates).toContainEqual({
      taskId: "task-1",
      runId: "run-1",
      kind: "error",
      errorTitle: "Cloud stream disconnected",
      errorMessage:
        "Lost connection to the cloud run stream. Retry to reconnect.",
      retryable: true,
    });
  });

  it("clears the backend-error budget after a healthy long-lived cut", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    const makeInProgressRun = () =>
      createJsonResponse({
        id: "run-1",
        status: "in_progress",
        stage: null,
        output: null,
        error_message: null,
        branch: "main",
        updated_at: "2026-01-01T00:00:00Z",
      });

    mockNetFetch
      .mockResolvedValueOnce(makeInProgressRun()) // bootstrap: fetchTaskRun
      .mockResolvedValueOnce(
        createJsonResponse([], 200, { "X-Has-More": "false" }),
      ) // bootstrap: fetchSessionLogs
      .mockImplementation(() => Promise.resolve(makeInProgressRun()));

    // First connection delivers an explicit backend error frame (accruing the
    // backend-error budget). Subsequent connections are healthy long-lived cuts
    // (>= SSE_HEALTHY_CONNECTION_MS): each proves the stream recovered and must
    // clear the backend-error budget, so it never accumulates for the run's life.
    let streamCall = 0;
    mockStreamFetch.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return Promise.resolve(
          createSseResponse('event: error\ndata: {"error":"boom"}\n\n'),
        );
      }
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('event: keepalive\ndata: {"type":"keepalive"}\n\n'),
          );
          setTimeout(() => controller.error(new Error("terminated")), 65_000);
        },
      });
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    });

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    const getWatcher = () =>
      (
        service as unknown as {
          watchers: Map<
            string,
            {
              reconnectAttempts: number;
              streamErrorAttempts: number;
              failed: boolean;
            }
          >;
        }
      ).watchers.get("task-1:run-1");

    // The backend error must have accrued the backend-error budget first...
    await waitFor(() => (getWatcher()?.streamErrorAttempts ?? 0) >= 1, 20_000);
    // ...then the healthy long-lived cut on the next connection clears it.
    await vi.advanceTimersByTimeAsync(67_000 * 2);
    await waitFor(() => getWatcher()?.streamErrorAttempts === 0, 20_000);

    const watcher = getWatcher();
    expect(watcher?.failed).toBe(false);
    expect(watcher?.streamErrorAttempts).toBe(0);
    expect(watcher?.reconnectAttempts).toBe(0);
    expect(
      updates.some(
        (u) =>
          typeof u === "object" &&
          u !== null &&
          (u as { kind?: string }).kind === "error",
      ),
    ).toBe(false);
  });

  it("counts quick stream failures and surfaces a retryable error", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    const makeInProgressRun = () =>
      createJsonResponse({
        id: "run-1",
        status: "in_progress",
        stage: null,
        output: null,
        error_message: null,
        branch: "main",
        updated_at: "2026-01-01T00:00:00Z",
      });

    mockNetFetch
      .mockResolvedValueOnce(makeInProgressRun())
      .mockResolvedValueOnce(
        createJsonResponse([], 200, { "X-Has-More": "false" }),
      )
      .mockImplementation(() => Promise.resolve(makeInProgressRun()));

    // Connections that fail immediately (under SSE_HEALTHY_CONNECTION_MS) are
    // genuine churn and must keep counting toward the retry budget.
    mockStreamFetch.mockImplementation(() =>
      Promise.resolve(
        createSseResponse('event: error\ndata: {"error":"boom"}\n\n'),
      ),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => mockStreamFetch.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(70_000);
    await waitFor(
      () =>
        updates.some(
          (u) =>
            typeof u === "object" &&
            u !== null &&
            (u as { kind?: string }).kind === "error",
        ),
      10_000,
    );

    expect(updates).toContainEqual({
      taskId: "task-1",
      runId: "run-1",
      kind: "error",
      errorTitle: "Cloud stream disconnected",
      errorMessage:
        "Lost connection to the cloud run stream. Retry to reconnect.",
      retryable: true,
    });
  });

  it("reconnects on a clean EOF even after the run status goes terminal (status-unaware)", async () => {
    vi.useFakeTimers();

    // Bootstrap sees an active run (so it streams); every later status fetch reports terminal.
    // Pre-decoupling, a clean EOF on a terminal run stopped the watch. Now run status is never
    // consulted to decide reconnects, so the clean EOFs keep reconnecting until stream-end.
    let statusFetchCount = 0;
    mockNetFetch.mockImplementation((input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/session_logs/")) {
        return Promise.resolve(
          createJsonResponse([], 200, { "X-Has-More": "false" }),
        );
      }
      statusFetchCount += 1;
      return Promise.resolve(
        createJsonResponse({
          id: "run-1",
          status: statusFetchCount === 1 ? "in_progress" : "completed",
          stage: null,
          output: null,
          error_message: null,
          branch: "main",
          updated_at:
            statusFetchCount === 1
              ? "2026-01-01T00:00:00Z"
              : "2026-01-01T00:00:01Z",
        }),
      );
    });

    mockStreamFetch.mockImplementation(() =>
      Promise.resolve(createSseResponse("")),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => mockStreamFetch.mock.calls.length === 1);
    await waitFor(() => mockStreamFetch.mock.calls.length >= 3, 20_000);

    // Terminal status did not stop the watch; the watcher is still reconnecting.
    expect(
      (service as unknown as { watchers: Map<string, unknown> }).watchers.has(
        "task-1:run-1",
      ),
    ).toBe(true);
  });

  it("surfaces a retryable error when the backend errors even on a long-lived stream", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    const makeInProgressRun = () =>
      createJsonResponse({
        id: "run-1",
        status: "in_progress",
        stage: null,
        output: null,
        error_message: null,
        branch: "main",
        updated_at: "2026-01-01T00:00:00Z",
      });

    mockNetFetch
      .mockResolvedValueOnce(makeInProgressRun())
      .mockResolvedValueOnce(
        createJsonResponse([], 200, { "X-Has-More": "false" }),
      )
      .mockImplementation(() => Promise.resolve(makeInProgressRun()));

    // Each connection stays open with a keepalive for 65s (> the healthy
    // threshold) and only THEN emits an explicit backend `event: error` frame.
    // An explicit backend error must always count toward the budget, so even a
    // long-lived stream eventually surfaces the retryable disconnect error.
    mockStreamFetch.mockImplementation(() => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('event: keepalive\ndata: {"type":"keepalive"}\n\n'),
          );
          setTimeout(() => {
            controller.enqueue(
              encoder.encode('event: error\ndata: {"error":"boom"}\n\n'),
            );
            controller.close();
          }, 65_000);
        },
      });
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    });

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => mockStreamFetch.mock.calls.length === 1);
    // Drive >= 10 long-lived-then-backend-error cycles (65s open + backoff each).
    await vi.advanceTimersByTimeAsync(65_000 * 11 + 70_000);
    await waitFor(
      () =>
        updates.some(
          (u) =>
            typeof u === "object" &&
            u !== null &&
            (u as { kind?: string }).kind === "error",
        ),
      10_000,
    );

    expect(updates).toContainEqual({
      taskId: "task-1",
      runId: "run-1",
      kind: "error",
      errorTitle: "Cloud stream disconnected",
      errorMessage:
        "Lost connection to the cloud run stream. Retry to reconnect.",
      retryable: true,
    });
  });

  it("treats a long-lived transport cut as healthy even with no frames received", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    const makeInProgressRun = () =>
      createJsonResponse({
        id: "run-1",
        status: "in_progress",
        stage: null,
        output: null,
        error_message: null,
        branch: "main",
        updated_at: "2026-01-01T00:00:00Z",
      });

    mockNetFetch
      .mockResolvedValueOnce(makeInProgressRun())
      .mockResolvedValueOnce(
        createJsonResponse([], 200, { "X-Has-More": "false" }),
      )
      .mockImplementation(() => Promise.resolve(makeInProgressRun()));

    // Each connection opens but delivers NOTHING, then is transport-cut at 65s.
    // Healthiness is duration-only on purpose — it must NOT depend on keepalive
    // frames surviving the proxy — so even a frame-less long-lived cut is healthy
    // and never exhausts the budget.
    mockStreamFetch.mockImplementation(() => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => controller.error(new Error("terminated")), 65_000);
        },
      });
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    });

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => mockStreamFetch.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(67_000 * 8);
    await waitFor(() => mockStreamFetch.mock.calls.length >= 6, 20_000);

    expect(
      updates.some(
        (u) =>
          typeof u === "object" &&
          u !== null &&
          (u as { kind?: string }).kind === "error",
      ),
    ).toBe(false);

    const watcher = (
      service as unknown as {
        watchers: Map<string, { reconnectAttempts: number; failed: boolean }>;
      }
    ).watchers.get("task-1:run-1");
    expect(watcher?.failed).toBe(false);
    expect(watcher?.reconnectAttempts).toBe(0);
  });

  it("never fails an idle run riding healthy clean-EOF reconnect cycles", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    mockNetFetch.mockImplementation((input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/session_logs/")) {
        return Promise.resolve(
          createJsonResponse([], 200, { "X-Has-More": "false" }),
        );
      }
      return Promise.resolve(
        createJsonResponse({
          id: "run-1",
          status: "in_progress",
          stage: null,
          output: null,
          error_message: null,
          branch: "main",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      );
    });

    // An idle run: every connection delivers only a keepalive, lives a healthy
    // 65s, then the server closes it cleanly. No data events ever arrive, so
    // nothing else resets the cumulative budget across the cycles.
    mockStreamFetch.mockImplementation(() => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('event: keepalive\ndata: {"type":"keepalive"}\n\n'),
          );
          setTimeout(() => controller.close(), 65_000);
        },
      });
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    });

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => mockStreamFetch.mock.calls.length === 1);
    // Ride out more cycles than the cumulative budget allows for loops.
    await vi.advanceTimersByTimeAsync(67_000 * 35);
    await waitFor(() => mockStreamFetch.mock.calls.length >= 32, 20_000);

    expect(
      updates.some(
        (u) =>
          typeof u === "object" &&
          u !== null &&
          (u as { kind?: string }).kind === "error",
      ),
    ).toBe(false);
    expect(
      (service as unknown as { watchers: Map<string, unknown> }).watchers.has(
        "task-1:run-1",
      ),
    ).toBe(true);
  });

  it("resets the transport reconnect budget once a keepalive proves recovery", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    const makeInProgressRun = () =>
      createJsonResponse({
        id: "run-1",
        status: "in_progress",
        stage: null,
        output: null,
        error_message: null,
        branch: "main",
        updated_at: "2026-01-01T00:00:00Z",
      });

    mockNetFetch
      .mockResolvedValueOnce(makeInProgressRun())
      .mockResolvedValueOnce(
        createJsonResponse([], 200, { "X-Has-More": "false" }),
      )
      .mockImplementation(() => Promise.resolve(makeInProgressRun()));

    // First 3 connections fail fast at the transport level (established, then
    // errored immediately, no frame) and accrue reconnect attempts. The 4th
    // delivers a keepalive and stays open — proving the transport recovered, so
    // the accrued attempts must reset rather than carry forward into the budget.
    let streamCall = 0;
    const keepaliveControllerRef: {
      current: ReadableStreamDefaultController<Uint8Array> | null;
    } = { current: null };
    const encoder = new TextEncoder();
    mockStreamFetch.mockImplementation(() => {
      streamCall += 1;
      if (streamCall <= 3) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("terminated"));
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      }
      // 4th connection stays open with no frame; the test injects the keepalive
      // below so it can observe the accrued budget BEFORE the reset.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          keepaliveControllerRef.current = controller;
        },
      });
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    });

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    const getWatcher = () =>
      (
        service as unknown as {
          watchers: Map<string, { reconnectAttempts: number; failed: boolean }>;
        }
      ).watchers.get("task-1:run-1");

    await waitFor(() => mockStreamFetch.mock.calls.length === 1);
    // Drive the 3 fast transport failures and open the held 4th connection.
    await vi.advanceTimersByTimeAsync(30_000);
    await waitFor(
      () => streamCall >= 4 && !!keepaliveControllerRef.current,
      20_000,
    );

    // Non-vacuous precondition: the fast failures actually accrued the budget.
    expect(getWatcher()?.reconnectAttempts ?? 0).toBeGreaterThan(0);

    // A keepalive on the recovered connection must reset the transport budget.
    keepaliveControllerRef.current?.enqueue(
      encoder.encode('event: keepalive\ndata: {"type":"keepalive"}\n\n'),
    );
    await waitFor(() => getWatcher()?.reconnectAttempts === 0, 20_000);

    const watcher = getWatcher();
    expect(watcher?.failed).toBe(false);
    expect(watcher?.reconnectAttempts).toBe(0);
    expect(
      updates.some(
        (u) =>
          typeof u === "object" &&
          u !== null &&
          (u as { kind?: string }).kind === "error",
      ),
    ).toBe(false);
  });

  it("does not let a stale backend-error count inflate a transport reconnect delay", async () => {
    vi.useFakeTimers();

    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    const makeInProgressRun = () =>
      createJsonResponse({
        id: "run-1",
        status: "in_progress",
        stage: null,
        output: null,
        error_message: null,
        branch: "main",
        updated_at: "2026-01-01T00:00:00Z",
      });

    mockNetFetch
      .mockResolvedValueOnce(makeInProgressRun()) // bootstrap: fetchTaskRun
      .mockResolvedValueOnce(
        createJsonResponse([], 200, { "X-Has-More": "false" }),
      ) // bootstrap: fetchSessionLogs
      .mockImplementation(() => Promise.resolve(makeInProgressRun()));

    // Connections 1-4 each emit a backend `event: error` frame, building the
    // backend-error budget to 4 — those reconnects correctly pace on
    // streamErrorAttempts. Connection 5 is held open until the test injects a
    // quick TRANSPORT cut, which must pace its reconnect on the just-incremented
    // transport budget (1 -> ~2s), NOT on the stale backend-error budget
    // (4 -> ~16s). Math.max(both) for the delay would wrongly use the latter.
    let streamCall = 0;
    const transportControllerRef: {
      current: ReadableStreamDefaultController<Uint8Array> | null;
    } = { current: null };
    mockStreamFetch.mockImplementation(() => {
      streamCall += 1;
      if (streamCall <= 4) {
        return Promise.resolve(
          createSseResponse('event: error\ndata: {"error":"boom"}\n\n'),
        );
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (streamCall === 5) {
            transportControllerRef.current = controller;
          }
        },
      });
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    });

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    const getWatcher = () =>
      (
        service as unknown as {
          watchers: Map<
            string,
            {
              reconnectAttempts: number;
              streamErrorAttempts: number;
              failed: boolean;
            }
          >;
        }
      ).watchers.get("task-1:run-1");

    await waitFor(() => mockStreamFetch.mock.calls.length === 1);
    // Drive the four backend-error reconnects (2s + 4s + 8s + 16s of backoff)
    // and open the held fifth connection.
    await vi.advanceTimersByTimeAsync(35_000);
    await waitFor(
      () => streamCall >= 5 && !!transportControllerRef.current,
      20_000,
    );

    // Non-vacuous precondition: the backend-error budget is stale-high while the
    // transport budget is still zero.
    expect(getWatcher()?.streamErrorAttempts).toBe(4);
    expect(getWatcher()?.reconnectAttempts).toBe(0);
    expect(getWatcher()?.failed).toBe(false);

    // A quick transport cut on the open fifth connection charges ONE transport
    // attempt; its reconnect must wait ~2s (transport budget), not ~16s.
    transportControllerRef.current?.error(new Error("terminated"));
    await waitFor(() => getWatcher()?.reconnectAttempts === 1, 20_000);
    expect(getWatcher()?.streamErrorAttempts).toBe(4);

    const callsBeforeProbe = mockStreamFetch.mock.calls.length;
    // 5s is past the fixed ~2s transport backoff but well short of the buggy
    // ~16s backend-error backoff, so the sixth connection only opens if the
    // delay was paced on the transport budget.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockStreamFetch.mock.calls.length).toBe(callsBeforeProbe + 1);
    expect(getWatcher()?.failed).toBe(false);
  });

  it("does not poll run status per reconnect on clean EOFs (status-unaware)", async () => {
    vi.useFakeTimers();

    let statusFetchCount = 0;
    mockNetFetch.mockImplementation((input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/session_logs/")) {
        return Promise.resolve(
          createJsonResponse([], 200, { "X-Has-More": "false" }),
        );
      }
      statusFetchCount += 1;
      return Promise.resolve(
        createJsonResponse({
          id: "run-1",
          status: "in_progress",
          stage: null,
          output: null,
          error_message: null,
          branch: "main",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      );
    });

    // Every connection ends cleanly with no stream-end sentinel, forcing reconnect after reconnect.
    mockStreamFetch.mockImplementation(() =>
      Promise.resolve(createSseResponse("")),
    );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => mockStreamFetch.mock.calls.length >= 5, 20_000);

    // Bootstrap fetches status once and the post-bootstrap verification once more; reconnects add
    // none. Pre-decoupling, every clean EOF polled status, so this count would climb with reconnects.
    expect(statusFetchCount).toBeLessThanOrEqual(2);
  });

  const guardedFetchStatusExpectations = [
    [
      401,
      {
        errorTitle: "Cloud authentication expired",
        errorMessage: "Please reauthenticate and retry the cloud run stream.",
        retryable: true,
      },
    ],
    [
      403,
      {
        errorTitle: "Cloud access denied",
        errorMessage:
          "You no longer have access to this cloud run. Reauthenticate and retry.",
        retryable: true,
      },
    ],
    [
      404,
      {
        errorTitle: "Cloud run not found",
        errorMessage:
          "This cloud run could not be found. It may have been deleted or moved.",
        retryable: false,
      },
    ],
  ] as const;

  const guardedFetchStatusCases = (
    ["status fetch", "persisted log fetch"] as const
  ).flatMap((fetchPhase) =>
    guardedFetchStatusExpectations.map(([status, expectedError]) => ({
      fetchPhase,
      status,
      expectedError,
    })),
  );

  it.each(guardedFetchStatusCases)(
    "fails the watcher when $fetchPhase returns $status",
    async ({ fetchPhase, status, expectedError }) => {
      const updates: unknown[] = [];
      service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

      if (fetchPhase === "status fetch") {
        mockNetFetch.mockResolvedValueOnce(
          createJsonResponse({ detail: "Access denied" }, status),
        );
      } else {
        mockNetFetch
          .mockResolvedValueOnce(
            createJsonResponse({
              id: "run-1",
              status: "completed",
              stage: null,
              output: null,
              error_message: null,
              branch: "main",
              updated_at: "2026-01-01T00:00:00Z",
              completed_at: "2026-01-01T00:00:01Z",
            }),
          )
          .mockResolvedValueOnce(
            createJsonResponse({ detail: "Access denied" }, status),
          );
      }

      service.watch({
        taskId: "task-1",
        runId: "run-1",
        apiHost: "https://app.example.com",
        teamId: 2,
      });

      await waitFor(() => updates.length === 1);

      expect(mockStreamFetch).not.toHaveBeenCalled();
      expect(updates).toContainEqual({
        taskId: "task-1",
        runId: "run-1",
        kind: "error",
        ...expectedError,
      });
    },
  );

  it("loads paginated persisted logs once for an already terminal run", async () => {
    const updates: unknown[] = [];
    service.on(CloudTaskEvent.Update, (payload) => updates.push(payload));

    mockNetFetch
      .mockResolvedValueOnce(
        createJsonResponse({
          id: "run-1",
          status: "completed",
          stage: "build",
          output: null,
          error_message: null,
          branch: "main",
          updated_at: "2026-01-01T00:00:00Z",
          completed_at: "2026-01-01T00:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse(
          [
            {
              type: "notification",
              timestamp: "2026-01-01T00:00:01Z",
              notification: {
                jsonrpc: "2.0",
                method: "_posthog/console",
                params: {
                  sessionId: "run-1",
                  level: "info",
                  message: "done-1",
                },
              },
            },
          ],
          200,
          { "X-Has-More": "true" },
        ),
      )
      .mockResolvedValueOnce(
        createJsonResponse(
          [
            {
              type: "notification",
              timestamp: "2026-01-01T00:00:02Z",
              notification: {
                jsonrpc: "2.0",
                method: "_posthog/console",
                params: {
                  sessionId: "run-1",
                  level: "info",
                  message: "done-2",
                },
              },
            },
          ],
          200,
          { "X-Has-More": "false" },
        ),
      );

    service.watch({
      taskId: "task-1",
      runId: "run-1",
      apiHost: "https://app.example.com",
      teamId: 2,
    });

    await waitFor(() => updates.length >= 1);

    expect(updates).toEqual([
      {
        taskId: "task-1",
        runId: "run-1",
        kind: "snapshot",
        newEntries: [
          {
            type: "notification",
            timestamp: "2026-01-01T00:00:01Z",
            notification: {
              jsonrpc: "2.0",
              method: "_posthog/console",
              params: {
                sessionId: "run-1",
                level: "info",
                message: "done-1",
              },
            },
          },
          {
            type: "notification",
            timestamp: "2026-01-01T00:00:02Z",
            notification: {
              jsonrpc: "2.0",
              method: "_posthog/console",
              params: {
                sessionId: "run-1",
                level: "info",
                message: "done-2",
              },
            },
          },
        ],
        totalEntryCount: 2,
        status: "completed",
        stage: "build",
        output: null,
        errorMessage: null,
        branch: "main",
      },
    ]);
    expect(mockNetFetch).toHaveBeenCalledTimes(3);
  });
});
