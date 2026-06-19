import { beforeEach, describe, expect, it } from "vitest";
import type { PendingAttachment } from "../composer/attachments/types";
import {
  combineQueuedMessages,
  type QueuedMessage,
  useMessageQueueStore,
} from "./messageQueueStore";

function image(id: string): PendingAttachment {
  return {
    kind: "image",
    id,
    uri: `file://${id}.png`,
    fileName: `${id}.png`,
    mimeType: "image/png",
  };
}

describe("messageQueueStore", () => {
  beforeEach(() => {
    useMessageQueueStore.setState({ queuesByTaskId: {} }, false);
  });

  it("enqueues messages in FIFO order", () => {
    const { enqueue, getQueue } = useMessageQueueStore.getState();
    enqueue("t1", "first", []);
    enqueue("t1", "second", []);
    enqueue("t1", "third", []);
    expect(getQueue("t1").map((m) => m.content)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("keeps separate queues per task", () => {
    const { enqueue, getQueue } = useMessageQueueStore.getState();
    enqueue("t1", "a", []);
    enqueue("t2", "b", []);
    expect(getQueue("t1").map((m) => m.content)).toEqual(["a"]);
    expect(getQueue("t2").map((m) => m.content)).toEqual(["b"]);
  });

  it("drains the queue in order and clears it", () => {
    const { enqueue, drain, getQueue } = useMessageQueueStore.getState();
    enqueue("t1", "a", []);
    enqueue("t1", "b", []);
    expect(drain("t1").map((m) => m.content)).toEqual(["a", "b"]);
    expect(getQueue("t1")).toEqual([]);
    // A second drain on the emptied queue is a no-op.
    expect(drain("t1")).toEqual([]);
  });

  it("prepends restored messages at the head (failed-flush rollback)", () => {
    const { enqueue, drain, prepend, getQueue } =
      useMessageQueueStore.getState();
    enqueue("t1", "a", []);
    enqueue("t1", "b", []);
    const drained = drain("t1");

    // A new message arrives while the flush is in flight.
    enqueue("t1", "c", []);
    // Flush failed — the drained messages go back ahead of the newcomer.
    prepend("t1", drained);

    expect(getQueue("t1").map((m) => m.content)).toEqual(["a", "b", "c"]);
  });
});

describe("combineQueuedMessages", () => {
  function msg(
    content: string,
    attachments: PendingAttachment[],
  ): QueuedMessage {
    return { content, attachments };
  }

  it("joins text in order with a blank line and concatenates attachments", () => {
    const result = combineQueuedMessages([
      msg("first", [image("one")]),
      msg("second", []),
      msg("third", [image("two"), image("three")]),
    ]);
    expect(result.text).toBe("first\n\nsecond\n\nthird");
    expect(result.attachments.map((a) => a.id)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("handles an empty list", () => {
    expect(combineQueuedMessages([])).toEqual({ text: "", attachments: [] });
  });
});
