import { create } from "zustand";
import type { PendingAttachment } from "../composer/attachments/types";

export interface QueuedMessage {
  content: string;
  attachments: PendingAttachment[];
}

const EMPTY: QueuedMessage[] = [];

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
          { content, attachments },
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
