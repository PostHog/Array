import type { AcpMessage, AgentSession } from "@posthog/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionService, type SessionServiceDeps } from "./sessionService";

const TASK_ID = "task-1";
const RUN_ID = "run-1";
const FLUSH_MS = 16;

/** A plain streamed agent-message chunk — the common per-token event that just
 * gets appended to the transcript. */
function chunk(text: string): AcpMessage {
  return {
    ts: 1,
    message: {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: RUN_ID,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      },
    },
  } as unknown as AcpMessage;
}

function chunkText(event: AcpMessage): string {
  const params = (event.message as { params?: unknown }).params as {
    update: { content: { text: string } };
  };
  return params.update.content.text;
}

/** The renderer-side echo of a user prompt — a JSON-RPC request (carries an
 * id), so it must not be coalesced with plain notifications. */
function promptEcho(id: number, text: string, ts = 1): AcpMessage {
  return {
    ts,
    message: {
      jsonrpc: "2.0",
      id,
      method: "session/prompt",
      params: {
        sessionId: RUN_ID,
        prompt: [{ type: "text", text }],
      },
    },
  } as unknown as AcpMessage;
}

/** The agent's terminal response for a prompt — completes the turn. */
function stopResponse(id: number, ts = 2): AcpMessage {
  return {
    ts,
    message: {
      jsonrpc: "2.0",
      id,
      result: { stopReason: "end_turn" },
    },
  } as unknown as AcpMessage;
}

function createHarness() {
  const sessions: Record<string, AgentSession> = {
    [RUN_ID]: {
      taskRunId: RUN_ID,
      taskId: TASK_ID,
      taskTitle: "Local Task",
      events: [],
      messageQueue: [],
      pendingPermissions: new Map(),
      status: "connected",
    } as unknown as AgentSession,
  };

  const appendEvents = vi.fn(
    (taskRunId: string, events: AcpMessage[], newLineCount?: number) => {
      const session = sessions[taskRunId];
      if (!session) return;
      session.events = [...session.events, ...events];
      if (newLineCount !== undefined) session.processedLineCount = newLineCount;
    },
  );

  const store = {
    getSessions: () => sessions,
    getSessionByTaskId: (taskId: string) =>
      Object.values(sessions).find((s) => s.taskId === taskId),
    setSession: (session: AgentSession) => {
      sessions[session.taskRunId] = session;
    },
    updateSession: (taskRunId: string, updates: Partial<AgentSession>) => {
      // Like the real store: produce a NEW session object per update, so a
      // reference captured before the update keeps its pre-update values
      // (handleSessionEvent's stop-reason check depends on that).
      const session = sessions[taskRunId];
      if (session) sessions[taskRunId] = { ...session, ...updates };
    },
    appendEvents,
    replaceOptimisticWithEvent: vi.fn(),
    setPendingPermissions: vi.fn(),
    clearMessageQueue: vi.fn(),
    clearTailOptimisticItems: vi.fn(),
    appendOptimisticItem: vi.fn(),
  };

  let onEvent: ((payload: unknown) => void) | undefined;
  const noopLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const notifyPromptComplete = vi.fn();
  const deps = {
    store,
    log: noopLog,
    notifyPromptComplete,
    notifyPermissionRequest: vi.fn(),
    taskViewedApi: { markActivity: vi.fn() },
    getPersistedConfigOptions: () => undefined,
    setPersistedConfigOptions: vi.fn(),
    trpc: {
      agent: {
        onSessionEvent: {
          subscribe: (
            _input: unknown,
            handlers: { onData: (payload: unknown) => void },
          ) => {
            onEvent = handlers.onData;
            return { unsubscribe: vi.fn() };
          },
        },
        onPermissionRequest: {
          subscribe: () => ({ unsubscribe: vi.fn() }),
        },
        onSessionIdleKilled: {
          subscribe: () => ({ unsubscribe: vi.fn() }),
        },
      },
    },
  } as unknown as SessionServiceDeps;

  const service = new SessionService(deps);
  // Register the streamed-event subscription (captures onData).
  (
    service as unknown as { subscribeToChannel(id: string): void }
  ).subscribeToChannel(RUN_ID);
  if (!onEvent)
    throw new Error("subscribeToChannel did not subscribe to events");

  return {
    service,
    appendEvents,
    notifyPromptComplete,
    updateSession: store.updateSession,
    emit: (event: AcpMessage) => onEvent?.(event),
    events: () => sessions[RUN_ID].events,
  };
}

describe("streamed event batching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defers a burst and applies it on one flush tick, in order", () => {
    const h = createHarness();

    h.emit(chunk("a"));
    h.emit(chunk("b"));
    h.emit(chunk("c"));

    // Nothing is applied synchronously — the burst is buffered.
    expect(h.appendEvents).not.toHaveBeenCalled();
    expect(h.events()).toHaveLength(0);

    // A single flush tick drains the whole burst, in arrival order.
    vi.advanceTimersByTime(FLUSH_MS);
    expect(h.events().map(chunkText)).toEqual(["a", "b", "c"]);
  });

  // Coalescing table: chunks are plain notifications (coalesce into one
  // appendEvents call per run — each store write costs O(transcript), so this
  // is the batching that keeps big transcripts smooth during streaming);
  // { echoId } items are id-carrying prompt echoes handled individually.
  it.each<{
    name: string;
    emitted: (string | { echoId: number })[];
    expectedGroups: string[][];
  }>([
    {
      name: "coalesces a run of plain notifications into one appendEvents call",
      emitted: ["a", "b", "c"],
      expectedGroups: [["a", "b", "c"]],
    },
    {
      name: "an id-carrying event splits the run but preserves global order",
      emitted: ["a", "b", { echoId: 7 }, "c"],
      expectedGroups: [["a", "b"], ["c"]],
    },
    {
      name: "consecutive id-carrying events do not produce empty appends",
      emitted: ["a", { echoId: 7 }, { echoId: 8 }, "b"],
      expectedGroups: [["a"], ["b"]],
    },
    {
      name: "a single-notification batch appends once",
      emitted: ["a"],
      expectedGroups: [["a"]],
    },
    {
      name: "a batch of only id-carrying events never calls appendEvents",
      emitted: [{ echoId: 7 }],
      expectedGroups: [],
    },
  ])("$name", ({ emitted, expectedGroups }) => {
    const h = createHarness();

    for (const item of emitted) {
      h.emit(
        typeof item === "string"
          ? chunk(item)
          : promptEcho(item.echoId, "user prompt"),
      );
    }
    vi.advanceTimersByTime(FLUSH_MS);

    expect(
      h.appendEvents.mock.calls.map((call) => call[1].map(chunkText)),
    ).toEqual(expectedGroups);
    // Arrival order is preserved in the transcript (echoes go through
    // replaceOptimisticWithEvent, so only chunks land in `events`).
    expect(h.events().map(chunkText)).toEqual(
      emitted.filter((item) => typeof item === "string"),
    );
  });

  it("a stop-reason response batched with chunks still completes the turn", () => {
    const h = createHarness();

    // Turn starts: the echo claims currentPromptId…
    h.emit(promptEcho(9, "do the thing"));
    // …streams some content…
    h.emit(chunk("a"));
    h.emit(chunk("b"));
    // …and finishes, all within one flush window.
    h.emit(stopResponse(9));
    vi.advanceTimersByTime(FLUSH_MS);

    // Transcript keeps everything appendable: the two chunks plus the
    // response itself (the echo goes through replaceOptimisticWithEvent).
    expect(h.events()).toHaveLength(3);
    expect(h.events().slice(0, 2).map(chunkText)).toEqual(["a", "b"]);
    expect(h.notifyPromptComplete).toHaveBeenCalledTimes(1);
  });

  it("flushes buffered events synchronously on teardown", () => {
    const h = createHarness();

    h.emit(chunk("a"));
    h.emit(chunk("b"));
    expect(h.events()).toHaveLength(0);

    // reset() tears down subscriptions and must not drop buffered events.
    h.service.reset();
    expect(h.events().map(chunkText)).toEqual(["a", "b"]);

    // The flush timer was cleared, so advancing does not re-apply anything.
    vi.advanceTimersByTime(FLUSH_MS);
    expect(h.events()).toHaveLength(2);
  });

  it("keeps the turn duration when the prompt mutation clears state before the response flushes", () => {
    const h = createHarness();

    h.emit(promptEcho(1, "user prompt", 1_000));
    vi.advanceTimersByTime(FLUSH_MS);

    h.emit(stopResponse(1, 6_000));
    h.updateSession(RUN_ID, { isPromptPending: false, promptStartedAt: null });
    vi.advanceTimersByTime(FLUSH_MS);

    expect(h.notifyPromptComplete).toHaveBeenCalledWith(
      "Local Task",
      "end_turn",
      TASK_ID,
      5_000,
    );
  });
});
