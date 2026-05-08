import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../utils/logger";
import { TaskRunEventStreamSender } from "./event-stream-sender";

describe("TaskRunEventStreamSender", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts ordered NDJSON batches with the run-scoped token", async () => {
    let requestBody = "";
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        if (!body) {
          return new Response(JSON.stringify({ last_accepted_seq: 0 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        requestBody = body;
        return new Response(JSON.stringify({ last_accepted_seq: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const sender = new TaskRunEventStreamSender({
      apiUrl: "http://localhost:8000/",
      projectId: 1,
      taskId: "task-1",
      runId: "run-1",
      token: "ingest-token",
      logger: new Logger({ debug: false }),
    });

    sender.enqueue({ type: "notification", notification: { method: "first" } });
    sender.enqueue({
      type: "notification",
      notification: { method: "second" },
    });
    await sender.stop();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://localhost:8000/api/projects/1/tasks/task-1/runs/run-1/event_stream/",
    );
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({
      Authorization: "Bearer ingest-token",
      "Content-Type": "application/x-ndjson",
    });
    expect(fetchMock.mock.calls[2][1]?.headers).toEqual({
      Authorization: "Bearer ingest-token",
      "Content-Type": "application/x-ndjson",
      "X-PostHog-Event-Stream-Complete": "true",
      "X-PostHog-Event-Stream-Final-Seq": "2",
    });
    expect(fetchMock.mock.calls[2][1]?.body).toBe("");

    const lines = requestBody
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toEqual([
      {
        seq: 1,
        event: { type: "notification", notification: { method: "first" } },
      },
      {
        seq: 2,
        event: { type: "notification", notification: { method: "second" } },
      },
    ]);
  });

  it("aborts a stuck ingest request", async () => {
    let aborted = false;
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        if (!String(init?.body ?? "")) {
          return new Response(JSON.stringify({ last_accepted_seq: 0 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const sender = new TaskRunEventStreamSender({
      apiUrl: "http://localhost:8000/",
      projectId: 1,
      taskId: "task-1",
      runId: "run-1",
      token: "ingest-token",
      logger: new Logger({ debug: false }),
      flushDelayMs: 0,
      requestTimeoutMs: 1,
      retryDelayMs: 1,
      stopTimeoutMs: 1,
    });

    sender.enqueue({ type: "notification", notification: { method: "first" } });
    await sender.stop();

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(aborted).toBe(true);
  });

  it("waits for the final ingest request before stop resolves", async () => {
    const ingestRequest: { resolve?: (response: Response) => void } = {};
    let stopped = false;
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        if (!body) {
          return new Response(JSON.stringify({ last_accepted_seq: 0 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Promise<Response>((resolve) => {
          ingestRequest.resolve = resolve;
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const sender = new TaskRunEventStreamSender({
      apiUrl: "http://localhost:8000/",
      projectId: 1,
      taskId: "task-1",
      runId: "run-1",
      token: "ingest-token",
      logger: new Logger({ debug: false }),
    });

    sender.enqueue({ type: "notification", notification: { method: "first" } });
    const stopPromise = sender.stop().then(() => {
      stopped = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stopped).toBe(false);

    const resolveIngest = ingestRequest.resolve;
    if (!resolveIngest) {
      throw new Error("expected ingest request to be in flight");
    }
    resolveIngest(
      new Response(JSON.stringify({ last_accepted_seq: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await stopPromise;

    expect(stopped).toBe(true);
  });

  it("posts an empty completion request on shutdown without buffered events", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => {
        return new Response(JSON.stringify({ last_accepted_seq: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const sender = new TaskRunEventStreamSender({
      apiUrl: "http://localhost:8000/",
      projectId: 1,
      taskId: "task-1",
      runId: "run-1",
      token: "ingest-token",
      logger: new Logger({ debug: false }),
    });

    await sender.stop();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.body).toBe("");
    expect(fetchMock.mock.calls[1][1]?.body).toBe("");
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      Authorization: "Bearer ingest-token",
      "Content-Type": "application/x-ndjson",
    });
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({
      Authorization: "Bearer ingest-token",
      "Content-Type": "application/x-ndjson",
      "X-PostHog-Event-Stream-Complete": "true",
      "X-PostHog-Event-Stream-Final-Seq": "0",
    });
  });

  it.each([
    {
      name: "when the buffer is full",
      senderOptions: { maxBufferedEvents: 1 },
      events: [
        { type: "notification", notification: { method: "first" } },
        { type: "notification", notification: { method: "second" } },
      ],
      acceptedMethod: "first",
    },
    {
      name: "when an event is oversized",
      senderOptions: { maxEventBytes: 120 },
      events: [
        {
          type: "notification",
          notification: {
            method: "oversized",
            params: { message: "x".repeat(200) },
          },
        },
        { type: "notification", notification: { method: "small" } },
      ],
      acceptedMethod: "small",
    },
  ])(
    "drops events before assigning sequence $name",
    async ({ senderOptions, events, acceptedMethod }) => {
      let requestBody = "";
      const fetchMock = vi.fn(
        async (_url: string | URL | Request, init?: RequestInit) => {
          const body = String(init?.body ?? "");
          if (!body) {
            return new Response(JSON.stringify({ last_accepted_seq: 0 }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          requestBody = body;
          return new Response(JSON.stringify({ last_accepted_seq: 1 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      const sender = new TaskRunEventStreamSender({
        apiUrl: "http://localhost:8000/",
        projectId: 1,
        taskId: "task-1",
        runId: "run-1",
        token: "ingest-token",
        logger: new Logger({ debug: false }),
        ...senderOptions,
      });

      for (const event of events) {
        sender.enqueue(event);
      }
      await sender.stop();

      const lines = requestBody
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(lines).toEqual([
        {
          seq: 1,
          event: {
            type: "notification",
            notification: { method: acceptedMethod },
          },
        },
      ]);
    },
  );

  it("accepts an event at the next sequence size boundary", async () => {
    let requestBody = "";
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        if (!body) {
          return new Response(JSON.stringify({ last_accepted_seq: 0 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        requestBody = body;
        return new Response(JSON.stringify({ last_accepted_seq: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const event = {
      type: "notification",
      notification: { method: "boundary" },
    };
    const maxEventBytes = new TextEncoder().encode(
      JSON.stringify({ seq: 1, event }),
    ).length;

    const sender = new TaskRunEventStreamSender({
      apiUrl: "http://localhost:8000/",
      projectId: 1,
      taskId: "task-1",
      runId: "run-1",
      token: "ingest-token",
      logger: new Logger({ debug: false }),
      maxEventBytes,
    });

    sender.enqueue(event);
    await sender.stop();

    const lines = requestBody
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toEqual([
      {
        seq: 1,
        event: {
          type: "notification",
          notification: { method: "boundary" },
        },
      },
    ]);
  });

  it("drains multiple capped batches on stop", async () => {
    const requestBodies: string[] = [];
    const completionBodies: string[] = [];
    const completionFinalSequences: string[] = [];
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers?.["X-PostHog-Event-Stream-Complete"] === "true") {
          completionBodies.push(body);
          completionFinalSequences.push(
            headers["X-PostHog-Event-Stream-Final-Seq"],
          );
          return new Response(JSON.stringify({ last_accepted_seq: 2 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (!body) {
          return new Response(JSON.stringify({ last_accepted_seq: 0 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        requestBodies.push(body);
        const lastSeq = JSON.parse(body.trim()).seq;
        return new Response(JSON.stringify({ last_accepted_seq: lastSeq }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const sender = new TaskRunEventStreamSender({
      apiUrl: "http://localhost:8000/",
      projectId: 1,
      taskId: "task-1",
      runId: "run-1",
      token: "ingest-token",
      logger: new Logger({ debug: false }),
      maxBatchEvents: 1,
    });

    sender.enqueue({ type: "notification", notification: { method: "first" } });
    sender.enqueue({
      type: "notification",
      notification: { method: "second" },
    });
    await sender.stop();

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies.map((body) => JSON.parse(body.trim()).seq)).toEqual([
      1, 2,
    ]);
    const ingestHeaders = fetchMock.mock.calls
      .filter(([, init]) => String(init?.body ?? "") !== "")
      .map(([, init]) => init?.headers as Record<string, string> | undefined);
    expect(
      ingestHeaders.map(
        (headers) => headers?.["X-PostHog-Event-Stream-Complete"],
      ),
    ).toEqual([undefined, undefined]);
    expect(completionBodies).toEqual([""]);
    expect(completionFinalSequences).toEqual(["2"]);
  });

  it("retries stop drain after a transient ingest failure", async () => {
    const requestBodies: string[] = [];
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        if (!body) {
          return new Response(JSON.stringify({ last_accepted_seq: 0 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        requestBodies.push(body);
        if (requestBodies.length === 1) {
          return new Response("temporary failure", { status: 503 });
        }

        return new Response(JSON.stringify({ last_accepted_seq: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const sender = new TaskRunEventStreamSender({
      apiUrl: "http://localhost:8000/",
      projectId: 1,
      taskId: "task-1",
      runId: "run-1",
      token: "ingest-token",
      logger: new Logger({ debug: false }),
      retryDelayMs: 1,
      stopTimeoutMs: 100,
    });

    sender.enqueue({ type: "notification", notification: { method: "first" } });
    await sender.stop();

    expect(requestBodies.map((body) => JSON.parse(body.trim()).seq)).toEqual([
      1, 1,
    ]);
  });

  it("stops draining buffered events after the stop deadline", async () => {
    const requestBodies: string[] = [];
    const warnings: string[] = [];
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        if (!body) {
          return new Response(JSON.stringify({ last_accepted_seq: 0 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 5));
        requestBodies.push(body);
        const lastSeq = JSON.parse(body.trim()).seq;
        return new Response(JSON.stringify({ last_accepted_seq: lastSeq }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const sender = new TaskRunEventStreamSender({
      apiUrl: "http://localhost:8000/",
      projectId: 1,
      taskId: "task-1",
      runId: "run-1",
      token: "ingest-token",
      logger: new Logger({
        debug: false,
        onLog: (level, _scope, message) => {
          if (level === "warn") {
            warnings.push(message);
          }
        },
      }),
      maxBatchEvents: 1,
      stopTimeoutMs: 1,
    });

    sender.enqueue({ type: "notification", notification: { method: "first" } });
    sender.enqueue({
      type: "notification",
      notification: { method: "second" },
    });
    await sender.stop();

    expect(requestBodies).toHaveLength(1);
    expect(JSON.parse(requestBodies[0].trim()).seq).toBe(1);
    expect(warnings).toContain(
      "Task run event ingest stop deadline reached before fully draining buffered events",
    );
  });

  it("continues after a payload error acknowledges a valid prefix", async () => {
    const requestBodies: string[] = [];
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        if (!body) {
          return new Response(JSON.stringify({ last_accepted_seq: 0 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        requestBodies.push(body);

        if (requestBodies.length === 1) {
          return new Response(
            JSON.stringify({
              error: "Too many events in request",
              last_accepted_seq: 1,
            }),
            {
              status: 413,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        return new Response(JSON.stringify({ last_accepted_seq: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const sender = new TaskRunEventStreamSender({
      apiUrl: "http://localhost:8000/",
      projectId: 1,
      taskId: "task-1",
      runId: "run-1",
      token: "ingest-token",
      logger: new Logger({ debug: false }),
      maxBatchEvents: 2,
    });

    sender.enqueue({ type: "notification", notification: { method: "first" } });
    sender.enqueue({
      type: "notification",
      notification: { method: "second" },
    });
    await sender.stop();

    expect(requestBodies).toHaveLength(2);
    expect(
      requestBodies.map((body) =>
        body
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).seq),
      ),
    ).toEqual([[1, 2], [2]]);
  });

  it("starts after the server's last accepted sequence on restart", async () => {
    const requestBodies: string[] = [];
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        if (!body) {
          return new Response(JSON.stringify({ last_accepted_seq: 42 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        requestBodies.push(body);
        return new Response(JSON.stringify({ last_accepted_seq: 44 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const sender = new TaskRunEventStreamSender({
      apiUrl: "http://localhost:8000/",
      projectId: 1,
      taskId: "task-1",
      runId: "run-1",
      token: "ingest-token",
      logger: new Logger({ debug: false }),
    });

    sender.enqueue({
      type: "notification",
      notification: { method: "after-restart" },
    });
    sender.enqueue({ type: "notification", notification: { method: "next" } });
    await sender.stop();

    expect(
      requestBodies[0]
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).seq),
    ).toEqual([43, 44]);
  });

  it("rebases buffered events after a sequence gap response", async () => {
    const requestBodies: string[] = [];
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        if (!body) {
          return new Response(JSON.stringify({ last_accepted_seq: 42 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        requestBodies.push(body);
        if (requestBodies.length === 1) {
          return new Response(
            JSON.stringify({
              error: "Expected sequence 1, got 43",
              last_accepted_seq: 0,
            }),
            {
              status: 409,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        return new Response(JSON.stringify({ last_accepted_seq: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const sender = new TaskRunEventStreamSender({
      apiUrl: "http://localhost:8000/",
      projectId: 1,
      taskId: "task-1",
      runId: "run-1",
      token: "ingest-token",
      logger: new Logger({ debug: false }),
    });

    sender.enqueue({
      type: "notification",
      notification: { method: "after-expiry" },
    });
    sender.enqueue({ type: "notification", notification: { method: "next" } });
    await sender.stop();

    expect(
      requestBodies.map((body) =>
        body
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).seq),
      ),
    ).toEqual([
      [43, 44],
      [1, 2],
    ]);
  });
});
