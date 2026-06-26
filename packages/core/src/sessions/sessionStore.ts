import type { ContentBlock } from "@agentclientprotocol/sdk";
import type {
  AcpMessage,
  AgentSession,
  OptimisticItem,
  PermissionRequest,
  QueuedMessage,
  TaskRunStatus,
} from "@posthog/shared";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

export interface SessionState {
  /** Sessions indexed by taskRunId */
  sessions: Record<string, AgentSession>;
  /** Index mapping taskId -> taskRunId for O(1) lookups */
  taskIdIndex: Record<string, string>;
}

export const sessionStore = createStore<SessionState>()(
  immer(() => ({
    sessions: {},
    taskIdIndex: {},
  })),
);

export const sessionStoreSetters = {
  setSession: (session: AgentSession) => {
    sessionStore.setState((state) => {
      // Clean up old session if taskId already has a different taskRunId
      const existingTaskRunId = state.taskIdIndex[session.taskId];
      if (existingTaskRunId && existingTaskRunId !== session.taskRunId) {
        delete state.sessions[existingTaskRunId];
      }

      state.sessions[session.taskRunId] = session;
      state.taskIdIndex[session.taskId] = session.taskRunId;
    });
  },

  removeSession: (taskRunId: string) => {
    sessionStore.setState((state) => {
      const session = state.sessions[taskRunId];
      if (session) {
        delete state.taskIdIndex[session.taskId];
      }
      delete state.sessions[taskRunId];
    });
  },

  updateSession: (taskRunId: string, updates: Partial<AgentSession>) => {
    sessionStore.setState((state) => {
      if (state.sessions[taskRunId]) {
        Object.assign(state.sessions[taskRunId], updates);
      }
    });
  },

  appendEvents: (
    taskRunId: string,
    events: AcpMessage[],
    newLineCount?: number,
  ) => {
    sessionStore.setState((state) => {
      const session = state.sessions[taskRunId];
      if (session) {
        session.events.push(...events);
        if (newLineCount !== undefined) {
          session.processedLineCount = newLineCount;
        }
      }
    });
  },

  updateCloudStatus: (
    taskRunId: string,
    fields: {
      status?: TaskRunStatus;
      stage?: string | null;
      output?: Record<string, unknown> | null;
      errorMessage?: string | null;
      branch?: string | null;
    },
  ) => {
    sessionStore.setState((state) => {
      const session = state.sessions[taskRunId];
      if (!session) return;
      if (fields.status !== undefined) session.cloudStatus = fields.status;
      if (fields.stage !== undefined) session.cloudStage = fields.stage;
      if (fields.output !== undefined) session.cloudOutput = fields.output;
      if (fields.errorMessage !== undefined)
        session.cloudErrorMessage = fields.errorMessage;
      if (fields.branch !== undefined) session.cloudBranch = fields.branch;
    });
  },

  setPendingPermissions: (
    taskRunId: string,
    permissions: Map<string, PermissionRequest>,
  ) => {
    sessionStore.setState((state) => {
      if (state.sessions[taskRunId]) {
        state.sessions[taskRunId].pendingPermissions = permissions;
      }
    });
  },

  enqueueMessage: (
    taskId: string,
    content: string,
    rawPrompt?: string | ContentBlock[],
  ) => {
    const id = `queue-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStore.setState((state) => {
      const taskRunId = state.taskIdIndex[taskId];
      if (!taskRunId) return;

      const session = state.sessions[taskRunId];
      if (session) {
        session.messageQueue.push({
          id,
          content,
          rawPrompt,
          queuedAt: Date.now(),
        });
      }
    });
  },

  removeQueuedMessage: (taskId: string, messageId: string) => {
    sessionStore.setState((state) => {
      const taskRunId = state.taskIdIndex[taskId];
      if (!taskRunId) return;
      const session = state.sessions[taskRunId];
      if (session) {
        session.messageQueue = session.messageQueue.filter(
          (msg) => msg.id !== messageId,
        );
      }
    });
  },

  clearMessageQueue: (taskId: string) => {
    sessionStore.setState((state) => {
      const taskRunId = state.taskIdIndex[taskId];
      if (!taskRunId) return;

      const session = state.sessions[taskRunId];
      if (session) {
        session.messageQueue = [];
      }
    });
  },

  dequeueMessagesAsText: (taskId: string): string | null => {
    // Read the queue from the frozen committed state BEFORE entering the
    // immer draft — same rationale as `dequeueMessages`: anything captured
    // through a draft proxy can be revoked when setState exits.
    const state = sessionStore.getState();
    const taskRunId = state.taskIdIndex[taskId];
    if (!taskRunId) return null;
    const session = state.sessions[taskRunId];
    if (!session || session.messageQueue.length === 0) return null;

    const combined = session.messageQueue
      .map((msg) => msg.content)
      .join("\n\n");
    sessionStore.setState((draft) => {
      const trid = draft.taskIdIndex[taskId];
      if (!trid) return;
      const draftSession = draft.sessions[trid];
      if (draftSession) draftSession.messageQueue = [];
    });
    return combined;
  },

  dequeueMessages: (taskId: string): QueuedMessage[] => {
    // Read the queue from the frozen committed state BEFORE entering the
    // immer draft, otherwise the items returned are proxies that get
    // revoked when setState exits and any later access throws
    // "Cannot perform 'get' on a proxy that has been revoked".
    const state = sessionStore.getState();
    const taskRunId = state.taskIdIndex[taskId];
    if (!taskRunId) return [];
    const session = state.sessions[taskRunId];
    if (!session || session.messageQueue.length === 0) return [];

    const queuedMessages = [...session.messageQueue];

    sessionStore.setState((draft) => {
      const trid = draft.taskIdIndex[taskId];
      if (!trid) return;
      const draftSession = draft.sessions[trid];
      if (draftSession) {
        draftSession.messageQueue = [];
      }
    });

    return queuedMessages;
  },

  /**
   * Splice messages back at the head of the queue. Used to roll back a
   * dispatch attempt that drained the queue but failed before delivery.
   */
  prependQueuedMessages: (taskId: string, messages: QueuedMessage[]) => {
    if (messages.length === 0) return;
    sessionStore.setState((state) => {
      const taskRunId = state.taskIdIndex[taskId];
      if (!taskRunId) return;
      const session = state.sessions[taskRunId];
      if (!session) return;
      session.messageQueue = [...messages, ...session.messageQueue];
    });
  },

  appendOptimisticItem: (
    taskRunId: string,
    item: OptimisticItem extends infer T
      ? T extends { id: string }
        ? Omit<T, "id">
        : never
      : never,
  ): void => {
    const id = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStore.setState((state) => {
      const session = state.sessions[taskRunId];
      if (session) {
        session.optimisticItems.push({ ...item, id } as OptimisticItem);
      }
    });
  },

  clearOptimisticItems: (taskRunId: string): void => {
    sessionStore.setState((state) => {
      const session = state.sessions[taskRunId];
      if (session) {
        session.optimisticItems = [];
      }
    });
  },

  clearTailOptimisticItems: (taskRunId: string): void => {
    sessionStore.setState((state) => {
      const session = state.sessions[taskRunId];
      if (session) {
        session.optimisticItems = session.optimisticItems.filter(
          (item) => item.type !== "user_message" || item.pinToTop !== false,
        );
      }
    });
  },

  replaceOptimisticWithEvent: (taskRunId: string, event: AcpMessage): void => {
    sessionStore.setState((state) => {
      const session = state.sessions[taskRunId];
      if (session) {
        session.events.push(event);
        session.optimisticItems = [];
      }
    });
  },

  /** O(1) lookup using taskIdIndex */
  getSessionByTaskId: (taskId: string): AgentSession | undefined => {
    const state = sessionStore.getState();
    const taskRunId = state.taskIdIndex[taskId];
    if (!taskRunId) return undefined;
    return state.sessions[taskRunId];
  },

  getSessions: (): Record<string, AgentSession> => {
    return sessionStore.getState().sessions;
  },

  clearAll: () => {
    sessionStore.setState((state) => {
      state.sessions = {};
      state.taskIdIndex = {};
    });
  },
};
