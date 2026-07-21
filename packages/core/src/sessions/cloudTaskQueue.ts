import { type QueuedMessage, sendableQueuePrefixLength } from "@posthog/shared";

export interface CloudTaskQueuedMessage<Attachment> extends QueuedMessage {
  attachments: Attachment[];
}

export type CloudTaskQueueMoveDirection = "up" | "down";

export interface CloudTaskQueueOptions {
  createId: () => string;
  now?: () => number;
}

export interface CloudTaskQueueDrainOptions {
  stopAtEdited?: boolean;
}

export interface CloudTaskQueueMessagePatch<Attachment> {
  content: string;
  attachments: readonly Attachment[];
}

export interface CloudTaskQueueSnapshot<Attachment> {
  queuesByTaskId: Readonly<
    Record<string, readonly CloudTaskQueuedMessage<Attachment>[]>
  >;
  editingByTaskId: Readonly<Record<string, string>>;
}

export type CloudTaskQueueListener = () => void;

const EMPTY_QUEUE: readonly never[] = [];

export class CloudTaskQueue<Attachment> {
  private readonly queuesByTaskId = new Map<
    string,
    CloudTaskQueuedMessage<Attachment>[]
  >();
  private readonly editingByTaskId = new Map<string, string>();
  private readonly listeners = new Set<CloudTaskQueueListener>();
  private readonly createId: () => string;
  private readonly now: () => number;
  private snapshot: CloudTaskQueueSnapshot<Attachment> = {
    queuesByTaskId: {},
    editingByTaskId: {},
  };

  constructor(options: CloudTaskQueueOptions) {
    this.createId = options.createId;
    this.now = options.now ?? Date.now;
  }

  enqueue(
    taskId: string,
    content: string,
    attachments: readonly Attachment[],
  ): CloudTaskQueuedMessage<Attachment> {
    const message = {
      id: this.createId(),
      content,
      attachments: [...attachments],
      queuedAt: this.now(),
    };
    const queue = this.queuesByTaskId.get(taskId);
    if (queue) {
      queue.push(message);
    } else {
      this.queuesByTaskId.set(taskId, [message]);
    }
    this.publish();
    return message;
  }

  drain(
    taskId: string,
    options?: CloudTaskQueueDrainOptions,
  ): CloudTaskQueuedMessage<Attachment>[] {
    const queue = this.queuesByTaskId.get(taskId);
    if (!queue || queue.length === 0) return [];

    const cutoff = options?.stopAtEdited
      ? sendableQueuePrefixLength({
          messageQueue: queue,
          editingQueuedId: this.editingByTaskId.get(taskId),
        })
      : queue.length;
    if (cutoff === 0) return [];

    const drained = queue.splice(0, cutoff);
    if (queue.length === 0) this.queuesByTaskId.delete(taskId);
    this.publish();
    return drained;
  }

  prepend(
    taskId: string,
    messages: readonly CloudTaskQueuedMessage<Attachment>[],
  ): void {
    if (messages.length === 0) return;
    const queue = this.queuesByTaskId.get(taskId) ?? [];
    this.queuesByTaskId.set(taskId, [
      ...messages.map((message) => ({
        ...message,
        attachments: [...message.attachments],
      })),
      ...queue,
    ]);
    this.publish();
  }

  remove(taskId: string, messageId: string): void {
    const queue = this.queuesByTaskId.get(taskId);
    if (!queue) return;

    const index = queue.findIndex((message) => message.id === messageId);
    if (index === -1) return;

    queue.splice(index, 1);
    if (queue.length === 0) this.queuesByTaskId.delete(taskId);
    if (this.editingByTaskId.get(taskId) === messageId) {
      this.editingByTaskId.delete(taskId);
    }
    this.publish();
  }

  move(
    taskId: string,
    messageId: string,
    direction: CloudTaskQueueMoveDirection,
  ): void {
    const queue = this.queuesByTaskId.get(taskId);
    if (!queue) return;

    const from = queue.findIndex((message) => message.id === messageId);
    if (from === -1) return;

    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= queue.length) return;

    const [message] = queue.splice(from, 1);
    queue.splice(to, 0, message);
    this.publish();
  }

  update(
    taskId: string,
    messageId: string,
    patch: CloudTaskQueueMessagePatch<Attachment>,
  ): void {
    const queue = this.queuesByTaskId.get(taskId);
    if (!queue) return;
    const index = queue.findIndex((message) => message.id === messageId);
    if (index === -1) return;

    queue[index] = {
      ...queue[index],
      content: patch.content,
      attachments: [...patch.attachments],
    };
    this.publish();
  }

  setEditing(taskId: string, messageId: string): void {
    if (this.editingByTaskId.get(taskId) === messageId) return;
    this.editingByTaskId.set(taskId, messageId);
    this.publish();
  }

  clearEditing(taskId: string): void {
    if (!this.editingByTaskId.delete(taskId)) return;
    this.publish();
  }

  getQueue(taskId: string): readonly CloudTaskQueuedMessage<Attachment>[] {
    return this.snapshot.queuesByTaskId[taskId] ?? EMPTY_QUEUE;
  }

  readonly getSnapshot = (): CloudTaskQueueSnapshot<Attachment> =>
    this.snapshot;

  readonly subscribe = (listener: CloudTaskQueueListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(): void {
    this.snapshot = {
      queuesByTaskId: Object.fromEntries(
        [...this.queuesByTaskId].map(([taskId, queue]) => [taskId, [...queue]]),
      ),
      editingByTaskId: Object.fromEntries(this.editingByTaskId),
    };
    for (const listener of this.listeners) listener();
  }
}

export function combineCloudTaskQueuedMessages<Attachment>(
  messages: readonly CloudTaskQueuedMessage<Attachment>[],
): { text: string; attachments: Attachment[] } {
  return {
    text: messages.map((message) => message.content).join("\n\n"),
    attachments: messages.flatMap((message) => message.attachments),
  };
}
