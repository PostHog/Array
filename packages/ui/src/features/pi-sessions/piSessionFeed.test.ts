import { describe, expect, it, vi } from "vitest";
import {
  applyPiEvent,
  emptyLiveFeed,
  mergeEntries,
  type PiEntries,
  PiEntriesSyncer,
  type PiEvent,
  type PiMessage,
} from "./piSessionFeed";

function entriesOf(...ids: string[]): PiEntries {
  return {
    entries: ids.map((id) => ({ type: "label", id, label: id })),
  } as unknown as PiEntries;
}

function userMessage(text: string): PiMessage {
  return { role: "user", content: text, timestamp: 1 } as PiMessage;
}

function assistantMessage(text: string): PiMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: 2,
  } as unknown as PiMessage;
}

describe("mergeEntries", () => {
  it("returns next when there is no previous state", () => {
    const next = entriesOf("a", "b");

    expect(mergeEntries(undefined, next)).toBe(next);
  });

  it("appends only unseen entries", () => {
    const previous = entriesOf("a", "b");
    const next = entriesOf("b", "c");

    const merged = mergeEntries(previous, next);

    expect(merged.entries.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });
});

describe("applyPiEvent", () => {
  it("appends user messages on message_start", () => {
    const message = userMessage("hi");
    const event = { type: "message_start", message } as PiEvent;

    const feed = applyPiEvent(emptyLiveFeed, event);

    expect(feed.liveMessages).toEqual([message]);
    expect(feed.streamingMessage).toBeNull();
  });

  it.each(["message_start", "message_update"] as const)(
    "streams assistant messages on %s",
    (type) => {
      const message = assistantMessage("draft");
      const event = { type, message } as PiEvent;

      const feed = applyPiEvent(emptyLiveFeed, event);

      expect(feed.streamingMessage).toBe(message);
      expect(feed.liveMessages).toEqual([]);
    },
  );

  it("finalizes the assistant message on message_end", () => {
    const streaming = assistantMessage("draft");
    const final = assistantMessage("done");
    const withStream = { streamingMessage: streaming, liveMessages: [] };
    const event = { type: "message_end", message: final } as PiEvent;

    const feed = applyPiEvent(withStream, event);

    expect(feed.streamingMessage).toBeNull();
    expect(feed.liveMessages).toEqual([final]);
  });

  it("ignores unrelated events", () => {
    const event = { type: "agent_settled" } as PiEvent;

    expect(applyPiEvent(emptyLiveFeed, event)).toBe(emptyLiveFeed);
  });
});

describe("PiEntriesSyncer", () => {
  it("fetches entries after the last seeded id and reports the merge", async () => {
    const fetchEntries = vi.fn().mockResolvedValue(entriesOf("c"));
    const onUpdate = vi.fn();
    const syncer = new PiEntriesSyncer(fetchEntries, onUpdate);

    syncer.seed(entriesOf("a", "b"));
    await syncer.sync();

    expect(fetchEntries).toHaveBeenCalledWith("b");
    const reported = onUpdate.mock.calls[0][0] as PiEntries;
    expect(reported.entries.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("coalesces a sync requested mid-flight into one follow-up pass", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchEntries = vi
      .fn()
      .mockImplementationOnce(async () => {
        await gate;
        return entriesOf("a");
      })
      .mockResolvedValue(entriesOf("b"));
    const onUpdate = vi.fn();
    const syncer = new PiEntriesSyncer(fetchEntries, onUpdate);

    const first = syncer.sync();
    await syncer.sync();
    await syncer.sync();
    release?.();
    await first;

    expect(fetchEntries).toHaveBeenCalledTimes(2);
    const lastReported = onUpdate.mock.calls.at(-1)?.[0] as PiEntries;
    expect(lastReported.entries.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("recovers after a failed fetch", async () => {
    const fetchEntries = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(entriesOf("a"));
    const onUpdate = vi.fn();
    const syncer = new PiEntriesSyncer(fetchEntries, onUpdate);

    await expect(syncer.sync()).rejects.toThrow("boom");
    await syncer.sync();

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});
