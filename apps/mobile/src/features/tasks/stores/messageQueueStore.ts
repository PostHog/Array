import { create } from "zustand";
import type { PendingAttachment } from "../composer/attachments/types";

export interface QueuedMessage {
  id: string;
  content: string;
  attachments: PendingAttachment[];
}

const EMPTY: QueuedMessage[] = [];

let queueIdCounter = 0;
function nextQueueId(): string {
  queueIdCounter += 1;
  return `queue-${queueIdCounter}`;
}

interface MessageQueueState {
  queuesByTaskId: Record<string, QueuedMessage[]>;
  enqueue: (
    taskId: string,
    content: string,
    attachments: PendingAttachment[],
  ) => void;
  /** Remove and return every queued message for a task, in FIFO order. */
  drain: (taskId: string) => QueuedMessage[];
  /** Restore messages at the head of the queue, e.g. after a failed flush. */
  prepend: (taskId: string, messages: QueuedMessage[]) => void;
  /** Drop a single queued message by id. */
  remove: (taskId: string, messageId: string) => void;
  getQueue: (taskId: string) => QueuedMessage[];
}

export const useMessageQueueStore = create<MessageQueueState>((set, get) => ({
  queuesByTaskId: {},
  enqueue: (taskId, content, attachments) =>
    set((state) => ({
      queuesByTaskId: {
        ...state.queuesByTaskId,
        [taskId]: [
          ...(state.queuesByTaskId[taskId] ?? []),
          { id: nextQueueId(), content, attachments },
        ],
      },
    })),
  drain: (taskId) => {
    const queued = get().queuesByTaskId[taskId] ?? EMPTY;
    if (queued.length === 0) return EMPTY;
    set((state) => {
      const { [taskId]: _drained, ...rest } = state.queuesByTaskId;
      return { queuesByTaskId: rest };
    });
    return queued;
  },
  prepend: (taskId, messages) =>
    set((state) => ({
      queuesByTaskId: {
        ...state.queuesByTaskId,
        [taskId]: [...messages, ...(state.queuesByTaskId[taskId] ?? [])],
      },
    })),
  remove: (taskId, messageId) =>
    set((state) => {
      const queue = state.queuesByTaskId[taskId];
      if (!queue) return state;
      const next = queue.filter((m) => m.id !== messageId);
      if (next.length === queue.length) return state;
      if (next.length === 0) {
        const { [taskId]: _emptied, ...rest } = state.queuesByTaskId;
        return { queuesByTaskId: rest };
      }
      return {
        queuesByTaskId: { ...state.queuesByTaskId, [taskId]: next },
      };
    }),
  getQueue: (taskId) => get().queuesByTaskId[taskId] ?? EMPTY,
}));

/**
 * Combine buffered messages into a single prompt, preserving the order they
 * were typed: texts join with a blank line, attachments concatenate.
 */
export function combineQueuedMessages(messages: QueuedMessage[]): {
  text: string;
  attachments: PendingAttachment[];
} {
  return {
    text: messages.map((m) => m.content).join("\n\n"),
    attachments: messages.flatMap((m) => m.attachments),
  };
}
