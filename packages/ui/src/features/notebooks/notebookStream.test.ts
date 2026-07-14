import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteNotebookCaret } from "./markdown-notebook/remoteCarets";
import {
  NotebookStreamController,
  type NotebookStreamEngine,
} from "./notebookStream";

type SseEvent = { id?: string; event: string; data: string };
type StreamOpts = {
  lastEventId?: string;
  signal: AbortSignal;
  onEvent: (event: SseEvent) => void;
};
type Connection = {
  opts: StreamOpts;
  resolve: () => void;
  reject: (error: unknown) => void;
};

function makeHarness() {
  const applied: Parameters<NotebookStreamEngine["applyRemoteUpdate"]>[0][] =
    [];
  let engineVersion = 1;
  const engine: NotebookStreamEngine = {
    applyRemoteUpdate: (event) => applied.push(event),
    get version() {
      return engineVersion;
    },
  };

  const connections: Connection[] = [];
  const publishes: {
    client_id: string;
    version: number;
    cursor: Record<string, number | undefined>;
  }[] = [];
  const client = {
    notebookCollabStream: vi.fn(
      (_shortId: string, opts: StreamOpts) =>
        new Promise<void>((resolve, reject) => {
          connections.push({ opts, resolve, reject });
        }),
    ),
    notebookPublishPresence: vi.fn(
      (_shortId: string, body: (typeof publishes)[number]) => {
        publishes.push(body);
        return Promise.resolve();
      },
    ),
  };

  const presenceEmits: RemoteNotebookCaret[][] = [];
  const controller = new NotebookStreamController({
    shortId: "nb1",
    clientId: "me",
    engine,
    getClient: () => client as unknown as PostHogAPIClient,
    onPresence: (carets) => presenceEmits.push(carets),
  });

  return {
    controller,
    applied,
    connections,
    publishes,
    presenceEmits,
    client,
    setEngineVersion: (version: number) => {
      engineVersion = version;
    },
  };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("NotebookStreamController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects on construction and forwards update frames to the engine", () => {
    const h = makeHarness();
    expect(h.connections).toHaveLength(1);

    h.connections[0].opts.onEvent({
      id: "5-1",
      event: "update",
      data: JSON.stringify({
        type: "update",
        version: 5,
        diff: [{ start: 0, end: 0, text: "x" }],
        base_crc: 7,
        client_id: "other",
      }),
    });

    expect(h.applied).toEqual([
      {
        version: 5,
        diff: [{ start: 0, end: 0, text: "x" }],
        baseCrc: 7,
        clientId: "other",
      },
    ]);
    h.controller.dispose();
  });

  it("derives the version from the event id when the payload has none", () => {
    const h = makeHarness();
    h.connections[0].opts.onEvent({
      id: "7-0",
      event: "update",
      data: JSON.stringify({ type: "update", client_id: "other" }),
    });

    expect(h.applied).toEqual([
      { version: 7, diff: undefined, baseCrc: undefined, clientId: "other" },
    ]);
    h.controller.dispose();
  });

  it("skips our own save echoes", () => {
    const h = makeHarness();
    h.connections[0].opts.onEvent({
      id: "5-1",
      event: "update",
      data: JSON.stringify({ type: "update", version: 5, client_id: "me" }),
    });

    expect(h.applied).toHaveLength(0);
    h.controller.dispose();
  });

  it("ignores legacy step frames but still tracks their id", async () => {
    const h = makeHarness();
    h.connections[0].opts.onEvent({ id: "9-1", event: "step", data: "{}" });
    expect(h.applied).toHaveLength(0);

    h.connections[0].resolve();
    await flush();

    expect(h.connections).toHaveLength(2);
    expect(h.connections[1].opts.lastEventId).toBe("9-1");
    h.controller.dispose();
  });

  it("reconnects immediately on clean close with the stored lastEventId", async () => {
    const h = makeHarness();
    h.connections[0].opts.onEvent({
      id: "5-1",
      event: "update",
      data: JSON.stringify({ type: "update", version: 5, client_id: "other" }),
    });
    // Presence frames carry no id and must not advance the resume cursor.
    h.connections[0].opts.onEvent({
      event: "presence",
      data: JSON.stringify({
        type: "presence",
        client_id: "peer",
        user_id: 3,
        user_name: "Ann",
        version: 5,
        cursor: { node_index: 0 },
      }),
    });

    h.connections[0].resolve();
    await flush();

    expect(h.connections).toHaveLength(2);
    expect(h.connections[1].opts.lastEventId).toBe("5-1");
    h.controller.dispose();
  });

  it("reconnects after a delay when the stream errors", async () => {
    const h = makeHarness();
    h.connections[0].reject(new Error("stream error"));
    await flush();
    expect(h.connections).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(h.connections).toHaveLength(2);
    h.controller.dispose();
  });

  it("emits remote carets from presence frames, mapped to editor field names", () => {
    const h = makeHarness();
    h.connections[0].opts.onEvent({
      event: "presence",
      data: JSON.stringify({
        type: "presence",
        client_id: "peer",
        user_id: 3,
        user_name: "Ann",
        version: 5,
        cursor: { node_index: 1, offset: 2, list_item_index: 4 },
      }),
    });

    expect(h.presenceEmits).toHaveLength(1);
    expect(h.presenceEmits[0]).toEqual([
      {
        clientId: "peer",
        userName: "Ann",
        color: expect.stringMatching(/^#/),
        position: { nodeIndex: 1, offset: 2, listItemIndex: 4 },
        version: 5,
      },
    ]);
    h.controller.dispose();
  });

  it("keeps only the latest ping per client and never renders our own", () => {
    const h = makeHarness();
    const ping = (clientId: string, offset: number): void =>
      h.connections[0].opts.onEvent({
        event: "presence",
        data: JSON.stringify({
          type: "presence",
          client_id: clientId,
          user_id: 3,
          user_name: "Ann",
          version: 5,
          cursor: { node_index: 0, offset },
        }),
      });

    ping("me", 1);
    expect(h.presenceEmits).toHaveLength(0);

    ping("peer", 1);
    ping("peer", 9);
    const last = h.presenceEmits.at(-1);
    expect(last).toHaveLength(1);
    expect(last?.[0].position).toEqual({
      nodeIndex: 0,
      offset: 9,
      listItemIndex: undefined,
    });
    h.controller.dispose();
  });

  it("picks up piggybacked author presence on update frames", () => {
    const h = makeHarness();
    h.connections[0].opts.onEvent({
      id: "6-1",
      event: "update",
      data: JSON.stringify({
        type: "update",
        version: 6,
        diff: [{ start: 0, end: 0, text: "x" }],
        client_id: "peer",
        user_id: 8,
        user_name: "Bob",
        cursor: { node_index: 2, offset: 1 },
      }),
    });

    expect(h.applied).toHaveLength(1);
    expect(h.presenceEmits.at(-1)).toEqual([
      expect.objectContaining({
        clientId: "peer",
        userName: "Bob",
        position: { nodeIndex: 2, offset: 1, listItemIndex: undefined },
        version: 6,
      }),
    ]);
    h.controller.dispose();
  });

  it("prunes carets not refreshed within the TTL", async () => {
    const h = makeHarness();
    h.connections[0].opts.onEvent({
      event: "presence",
      data: JSON.stringify({
        type: "presence",
        client_id: "peer",
        user_id: 3,
        user_name: "Ann",
        version: 5,
        cursor: { node_index: 0 },
      }),
    });
    expect(h.presenceEmits.at(-1)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(35_000);
    expect(h.presenceEmits.at(-1)).toEqual([]);
    h.controller.dispose();
  });

  it("ignores malformed presence payloads", () => {
    const h = makeHarness();
    h.connections[0].opts.onEvent({ event: "presence", data: "not json" });
    h.connections[0].opts.onEvent({
      event: "presence",
      data: JSON.stringify({ type: "presence", client_id: "peer" }),
    });

    expect(h.presenceEmits).toHaveLength(0);
    h.controller.dispose();
  });

  it("debounces caret publishes and skips unchanged positions", async () => {
    const h = makeHarness();
    h.controller.publishCaret({ nodeIndex: 0, offset: 1 });
    h.controller.publishCaret({ nodeIndex: 0, offset: 2 });
    expect(h.publishes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(250);
    expect(h.publishes).toEqual([
      {
        client_id: "me",
        version: 1,
        cursor: { node_index: 0, offset: 2, list_item_index: undefined },
      },
    ]);

    // Same position again within the heartbeat window: no extra POST.
    h.controller.publishCaret({ nodeIndex: 0, offset: 2 });
    await vi.advanceTimersByTimeAsync(250);
    expect(h.publishes).toHaveLength(1);
    h.controller.dispose();
  });

  it("re-publishes the last position as a heartbeat", async () => {
    const h = makeHarness();
    h.controller.publishCaret({ nodeIndex: 0, offset: 1 });
    await vi.advanceTimersByTimeAsync(250);
    expect(h.publishes).toHaveLength(1);

    h.setEngineVersion(4);
    await vi.advanceTimersByTimeAsync(10_250);
    expect(h.publishes).toHaveLength(2);
    expect(h.publishes[1]).toMatchObject({ client_id: "me", version: 4 });
    h.controller.dispose();
  });

  it("stops heartbeating after the caret leaves the notebook", async () => {
    const h = makeHarness();
    h.controller.publishCaret({ nodeIndex: 0, offset: 1 });
    await vi.advanceTimersByTimeAsync(250);
    expect(h.publishes).toHaveLength(1);

    h.controller.publishCaret(null);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.publishes).toHaveLength(1);
    h.controller.dispose();
  });

  it("dispose aborts the stream and stops reconnecting and publishing", async () => {
    const h = makeHarness();
    const signal = h.connections[0].opts.signal;
    h.controller.publishCaret({ nodeIndex: 0, offset: 1 });

    h.controller.dispose();
    expect(signal.aborted).toBe(true);

    h.connections[0].reject(
      new DOMException("The operation was aborted.", "AbortError"),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.connections).toHaveLength(1);
    expect(h.publishes).toHaveLength(0);
    h.controller.publishCaret({ nodeIndex: 0, offset: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.publishes).toHaveLength(0);
  });
});
