import { describe, expect, it, vi } from "vitest";
import {
  CloudTaskQueue,
  type CloudTaskQueuedMessage,
  combineCloudTaskQueuedMessages,
} from "./cloudTaskQueue";

interface Attachment {
  uri: string;
}

function createQueue(): CloudTaskQueue<Attachment> {
  let nextId = 0;
  let now = 100;
  return new CloudTaskQueue({
    createId: () => `message-${++nextId}`,
    now: () => ++now,
  });
}

function message(
  id: string,
  content: string,
  attachments: Attachment[] = [],
): CloudTaskQueuedMessage<Attachment> {
  return { id, content, attachments, queuedAt: 1 };
}

function ids(queue: CloudTaskQueue<Attachment>, taskId = "task-1"): string[] {
  return queue.getQueue(taskId).map(({ id }) => id);
}

describe("CloudTaskQueue", () => {
  it("enqueues messages in FIFO order with host-provided metadata", () => {
    const queue = createQueue();

    const first = queue.enqueue("task-1", "first", [{ uri: "one" }]);
    const second = queue.enqueue("task-1", "second", []);

    expect(queue.getQueue("task-1")).toEqual([first, second]);
    expect(first).toEqual({
      id: "message-1",
      content: "first",
      attachments: [{ uri: "one" }],
      queuedAt: 101,
    });
  });

  it("drains all messages in FIFO order by default", () => {
    const queue = createQueue();
    queue.enqueue("task-1", "first", []);
    queue.enqueue("task-1", "second", []);

    expect(queue.drain("task-1").map(({ content }) => content)).toEqual([
      "first",
      "second",
    ]);
    expect(queue.getQueue("task-1")).toEqual([]);
  });

  it("stops a drain before the message being edited", () => {
    const queue = createQueue();
    const first = queue.enqueue("task-1", "first", []);
    const edited = queue.enqueue("task-1", "edited", []);
    const last = queue.enqueue("task-1", "last", []);
    queue.setEditing("task-1", edited.id);

    expect(queue.drain("task-1", { stopAtEdited: true })).toEqual([first]);
    expect(queue.getQueue("task-1")).toEqual([edited, last]);
  });

  it("drains nothing when the head message is being edited", () => {
    const queue = createQueue();
    const first = queue.enqueue("task-1", "first", []);
    queue.enqueue("task-1", "second", []);
    queue.setEditing("task-1", first.id);

    expect(queue.drain("task-1", { stopAtEdited: true })).toEqual([]);
    expect(ids(queue)).toEqual(["message-1", "message-2"]);
  });

  it("ignores a stale edit boundary and drains the full queue", () => {
    const queue = createQueue();
    queue.enqueue("task-1", "first", []);
    queue.setEditing("task-1", "missing");

    expect(queue.drain("task-1", { stopAtEdited: true })).toHaveLength(1);
    expect(queue.getQueue("task-1")).toEqual([]);
  });

  it("prepends restored messages without changing their order", () => {
    const queue = createQueue();
    queue.enqueue("task-1", "last", []);

    queue.prepend("task-1", [message("a", "first"), message("b", "second")]);

    expect(ids(queue)).toEqual(["a", "b", "message-1"]);
  });

  it("removes a message and releases its edit boundary", () => {
    const queue = createQueue();
    queue.enqueue("task-1", "first", []);
    const edited = queue.enqueue("task-1", "edited", []);
    queue.enqueue("task-1", "last", []);
    queue.setEditing("task-1", edited.id);

    queue.remove("task-1", edited.id);

    expect(queue.drain("task-1", { stopAtEdited: true })).toHaveLength(2);
  });

  it.each([
    ["up" as const, "message-2", ["message-2", "message-1", "message-3"]],
    ["down" as const, "message-2", ["message-1", "message-3", "message-2"]],
  ])("moves a message one position %s", (direction, messageId, expected) => {
    const queue = createQueue();
    queue.enqueue("task-1", "first", []);
    queue.enqueue("task-1", "second", []);
    queue.enqueue("task-1", "third", []);

    queue.move("task-1", messageId, direction);

    expect(ids(queue)).toEqual(expected);
  });

  it.each([
    ["up" as const, "message-1"],
    ["down" as const, "message-3"],
    ["up" as const, "missing"],
  ])("does not move a message beyond the queue boundary", (direction, id) => {
    const queue = createQueue();
    queue.enqueue("task-1", "first", []);
    queue.enqueue("task-1", "second", []);
    queue.enqueue("task-1", "third", []);

    queue.move("task-1", id, direction);

    expect(ids(queue)).toEqual(["message-1", "message-2", "message-3"]);
  });

  it("updates content and generic attachments without changing position", () => {
    const queue = createQueue();
    const first = queue.enqueue("task-1", "first", [{ uri: "old" }]);
    queue.enqueue("task-1", "second", []);

    queue.update("task-1", first.id, {
      content: "edited",
      attachments: [{ uri: "new" }],
    });

    expect(queue.getQueue("task-1")).toEqual([
      { ...first, content: "edited", attachments: [{ uri: "new" }] },
      {
        id: "message-2",
        content: "second",
        attachments: [],
        queuedAt: 102,
      },
    ]);
  });

  it("clears an edit boundary so the whole queue can drain", () => {
    const queue = createQueue();
    const first = queue.enqueue("task-1", "first", []);
    queue.enqueue("task-1", "second", []);
    queue.setEditing("task-1", first.id);

    queue.clearEditing("task-1");

    expect(queue.drain("task-1", { stopAtEdited: true })).toHaveLength(2);
  });

  it("keeps queues and edit boundaries isolated by task", () => {
    const queue = createQueue();
    const first = queue.enqueue("task-1", "first", []);
    queue.enqueue("task-2", "second", []);
    queue.setEditing("task-1", first.id);

    expect(queue.drain("task-1", { stopAtEdited: true })).toEqual([]);
    expect(queue.drain("task-2", { stopAtEdited: true })).toHaveLength(1);
  });

  it("exposes stable snapshots and notifies subscribers after changes", () => {
    const queue = createQueue();
    const initialSnapshot = queue.getSnapshot();
    const snapshots: ReturnType<typeof queue.getSnapshot>[] = [];
    const unsubscribe = queue.subscribe(() =>
      snapshots.push(queue.getSnapshot()),
    );

    const queued = queue.enqueue("task-1", "first", [{ uri: "image" }]);
    queue.setEditing("task-1", queued.id);

    expect(queue.getSnapshot()).toBe(snapshots[1]);
    expect(queue.getSnapshot()).not.toBe(initialSnapshot);
    expect(snapshots).toEqual([
      {
        queuesByTaskId: { "task-1": [queued] },
        editingByTaskId: {},
      },
      {
        queuesByTaskId: { "task-1": [queued] },
        editingByTaskId: { "task-1": queued.id },
      },
    ]);

    unsubscribe();
    queue.clearEditing("task-1");
    expect(snapshots).toHaveLength(2);
  });

  it("does not notify subscribers for no-op operations", () => {
    const queue = createQueue();
    const listener = vi.fn();
    queue.subscribe(listener);

    queue.drain("missing");
    queue.prepend("task-1", []);
    queue.remove("task-1", "missing");
    queue.move("task-1", "missing", "up");
    queue.update("task-1", "missing", { content: "edited", attachments: [] });
    queue.clearEditing("task-1");

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not mutate an earlier snapshot when a message is updated", () => {
    const queue = createQueue();
    const queued = queue.enqueue("task-1", "first", [{ uri: "old" }]);
    const earlierSnapshot = queue.getSnapshot();

    queue.update("task-1", queued.id, {
      content: "edited",
      attachments: [{ uri: "new" }],
    });

    expect(earlierSnapshot.queuesByTaskId["task-1"]?.[0]).toEqual(queued);
    expect(queue.getSnapshot().queuesByTaskId["task-1"]?.[0]).toEqual({
      ...queued,
      content: "edited",
      attachments: [{ uri: "new" }],
    });
  });
});

describe("combineCloudTaskQueuedMessages", () => {
  it("joins content in order and preserves generic attachments", () => {
    const image = { uri: "image" };
    const file = { uri: "file" };

    expect(
      combineCloudTaskQueuedMessages([
        message("a", "first", [image]),
        message("b", "second", [file]),
      ]),
    ).toEqual({
      text: "first\n\nsecond",
      attachments: [image, file],
    });
  });
});
