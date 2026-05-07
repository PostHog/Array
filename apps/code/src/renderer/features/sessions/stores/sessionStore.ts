import type {
  ContentBlock,
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SessionConfigSelectOptions,
} from "@agentclientprotocol/sdk";
import type { ExecutionMode, TaskRunStatus } from "@shared/types";
import type { SkillButtonId } from "@shared/types/analytics";
import type { AcpMessage } from "@shared/types/session-events";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { PermissionRequest } from "../utils/parseSessionLogs";

// --- Types ---

/** Adapter type for different agent backends */
export type Adapter = "claude" | "codex";

export interface QueuedMessage {
  id: string;
  content: string;
  rawPrompt?: string | ContentBlock[];
  queuedAt: number;
}

export type { TaskRunStatus };

export type OptimisticItem =
  | {
      type: "user_message";
      id: string;
      content: string;
      timestamp: number;
      pinToTop?: boolean;
    }
  | {
      type: "skill_button_action";
      id: string;
      buttonId: SkillButtonId;
    };

export interface AgentSession {
  taskRunId: string;
  taskId: string;
  taskTitle: string;
  channel: string;
  events: AcpMessage[];
  startedAt: number;
  status: "connecting" | "connected" | "disconnected" | "error";
  errorTitle?: string;
  errorMessage?: string;
  isPromptPending: boolean;
  isCompacting: boolean;
  promptStartedAt: number | null;
  /** JSON-RPC id of the currently in-flight session/prompt request. Used to
   * correlate late-arriving responses (e.g. from a cancelled prior turn) so
   * they don't clear the pending state of a newer turn. */
  currentPromptId?: number | null;
  logUrl?: string;
  processedLineCount?: number;
  framework?: "claude";
  /** Agent adapter type (e.g., "claude" or "codex") */
  adapter?: Adapter;
  /** Session configuration options (model, mode, thought level, etc.) */
  configOptions?: SessionConfigOption[];
  pendingPermissions: Map<string, PermissionRequest>;
  /** Accumulated time (ms) spent waiting for user input (permissions, questions, etc.) */
  pausedDurationMs: number;
  messageQueue: QueuedMessage[];
  /** Whether this session is for a cloud run */
  isCloud?: boolean;
  /** Cloud task run status (only set for cloud sessions) */
  cloudStatus?: TaskRunStatus;
  /** Cloud task current stage */
  cloudStage?: string | null;
  /** Cloud task output (PR URL, commit SHA, etc.) */
  cloudOutput?: Record<string, unknown> | null;
  /** Cloud task error message */
  cloudErrorMessage?: string | null;
  /** Initial prompt to re-send on retry if the first connection attempt failed */
  initialPrompt?: ContentBlock[];
  /** Cloud task branch */
  cloudBranch?: string | null;
  /** Whether a cloud-to-local handoff is in progress */
  handoffInProgress?: boolean;
  /** Number of session/prompt events to skip from polled logs (set during resume) */
  skipPolledPromptCount?: number;
  optimisticItems: OptimisticItem[];
  /** Context window tokens used (from usage_update) */
  contextUsed?: number;
  /** Context window total size in tokens (from usage_update) */
  contextSize?: number;
  /** Pre-computed conversation summary for commit/PR generation context */
  conversationSummary?: string;
  idleKilled?: boolean;
  /** Semver of the connected agent process. Populated from the
   * `_posthog/run_started` notification so that the UI can gate features
   * against agent capabilities (especially relevant for cloud sandboxes
   * where the agent version can lag behind the desktop). */
  agentVersion?: string;
}

// --- Config Option Helpers ---

/**
 * Type guard to check if options array contains groups (vs flat options).
 */
export function isSelectGroup(
  options: SessionConfigSelectOptions,
): options is SessionConfigSelectGroup[] {
  return (
    options.length > 0 &&
    typeof options[0] === "object" &&
    "options" in options[0]
  );
}

/**
 * Flatten grouped select options into a flat array.
 */
export function flattenSelectOptions(
  options: SessionConfigSelectOptions,
): SessionConfigSelectOption[] {
  if (!options.length) return [];
  if (isSelectGroup(options)) {
    return options.flatMap((group) => group.options);
  }
  return options as SessionConfigSelectOption[];
}

/**
 * Merge live configOptions from server with persisted values.
 * Persisted values take precedence for currentValue.
 */
export function mergeConfigOptions(
  live: SessionConfigOption[],
  persisted: SessionConfigOption[],
): SessionConfigOption[] {
  const persistedMap = new Map(persisted.map((opt) => [opt.id, opt]));

  return live.map((liveOpt) => {
    const persistedOpt = persistedMap.get(liveOpt.id);
    if (persistedOpt) {
      return {
        ...liveOpt,
        currentValue: persistedOpt.currentValue,
      } as SessionConfigOption;
    }
    return liveOpt;
  });
}

/**
 * Get a config option by its category (e.g., "mode", "model", "thought_level").
 */
export function getConfigOptionByCategory(
  configOptions: SessionConfigOption[] | undefined,
  category: string,
): SessionConfigOption | undefined {
  return configOptions?.find((opt) => opt.category === category);
}

/**
 * Cycle to the next mode option value.
 * Returns the next value, or undefined if cycling is not possible.
 */
export function cycleModeOption(
  modeOption: SessionConfigOption | undefined,
  options?: { allowBypassPermissions?: boolean },
): string | undefined {
  if (!modeOption || modeOption.type !== "select") return undefined;

  const allOptions = flattenSelectOptions(modeOption.options);
  const filtered = options?.allowBypassPermissions
    ? allOptions
    : allOptions.filter(
        (opt) =>
          opt.value !== "bypassPermissions" && opt.value !== "full-access",
      );
  if (filtered.length === 0) return undefined;

  const currentIndex = filtered.findIndex(
    (opt) => opt.value === modeOption.currentValue,
  );
  if (currentIndex === -1) return filtered[0]?.value;

  const nextIndex = (currentIndex + 1) % filtered.length;
  return filtered[nextIndex]?.value;
}

/**
 * Get the current mode from configOptions (for backwards compatibility).
 * Returns the currentValue of the "mode" category config option.
 */
export function getCurrentModeFromConfigOptions(
  configOptions: SessionConfigOption[] | undefined,
): ExecutionMode | undefined {
  const modeOption = getConfigOptionByCategory(configOptions, "mode");
  return modeOption?.currentValue as ExecutionMode | undefined;
}

export interface SessionState {
  /** Sessions indexed by taskRunId */
  sessions: Record<string, AgentSession>;
  /** Index mapping taskId -> taskRunId for O(1) lookups */
  taskIdIndex: Record<string, string>;
}

// --- Store ---

export const useSessionStore = create<SessionState>()(
  immer(() => ({
    sessions: {},
    taskIdIndex: {},
  })),
);

// --- Re-exports ---

export type { PermissionRequest, ExecutionMode, SessionConfigOption };
export {
  getAvailableCommandsForTask,
  getPendingPermissionsForTask,
  getUserPromptsForTask,
  useAdapterForTask,
  useAvailableCommandsForTask,
  useConfigOptionForTask,
  useModeConfigOptionForTask,
  useModelConfigOptionForTask,
  useOptimisticItemsForTask,
  usePendingPermissionsForTask,
  useQueuedMessagesForTask,
  useSessionForTask,
  useSessions,
  useThoughtLevelConfigOptionForTask,
} from "../hooks/useSession";

// --- Setters ---

export const sessionStoreSetters = {
  setSession: (session: AgentSession) => {
    useSessionStore.setState((state) => {
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
    useSessionStore.setState((state) => {
      const session = state.sessions[taskRunId];
      if (session) {
        delete state.taskIdIndex[session.taskId];
      }
      delete state.sessions[taskRunId];
    });
  },

  updateSession: (taskRunId: string, updates: Partial<AgentSession>) => {
    useSessionStore.setState((state) => {
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
    useSessionStore.setState((state) => {
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
    useSessionStore.setState((state) => {
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
    useSessionStore.setState((state) => {
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
    useSessionStore.setState((state) => {
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
    useSessionStore.setState((state) => {
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
    useSessionStore.setState((state) => {
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
    const state = useSessionStore.getState();
    const taskRunId = state.taskIdIndex[taskId];
    if (!taskRunId) return null;
    const session = state.sessions[taskRunId];
    if (!session || session.messageQueue.length === 0) return null;

    const combined = session.messageQueue
      .map((msg) => msg.content)
      .join("\n\n");
    useSessionStore.setState((draft) => {
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
    const state = useSessionStore.getState();
    const taskRunId = state.taskIdIndex[taskId];
    if (!taskRunId) return [];
    const session = state.sessions[taskRunId];
    if (!session || session.messageQueue.length === 0) return [];

    const queuedMessages = [...session.messageQueue];

    useSessionStore.setState((draft) => {
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
    useSessionStore.setState((state) => {
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
    useSessionStore.setState((state) => {
      const session = state.sessions[taskRunId];
      if (session) {
        session.optimisticItems.push({ ...item, id } as OptimisticItem);
      }
    });
  },

  clearOptimisticItems: (taskRunId: string): void => {
    useSessionStore.setState((state) => {
      const session = state.sessions[taskRunId];
      if (session) {
        session.optimisticItems = [];
      }
    });
  },

  clearTailOptimisticItems: (taskRunId: string): void => {
    useSessionStore.setState((state) => {
      const session = state.sessions[taskRunId];
      if (session) {
        session.optimisticItems = session.optimisticItems.filter(
          (item) => item.type !== "user_message" || item.pinToTop !== false,
        );
      }
    });
  },

  replaceOptimisticWithEvent: (taskRunId: string, event: AcpMessage): void => {
    useSessionStore.setState((state) => {
      const session = state.sessions[taskRunId];
      if (session) {
        session.events.push(event);
        session.optimisticItems = [];
      }
    });
  },

  /** O(1) lookup using taskIdIndex */
  getSessionByTaskId: (taskId: string): AgentSession | undefined => {
    const state = useSessionStore.getState();
    const taskRunId = state.taskIdIndex[taskId];
    if (!taskRunId) return undefined;
    return state.sessions[taskRunId];
  },

  getSessions: (): Record<string, AgentSession> => {
    return useSessionStore.getState().sessions;
  },

  clearAll: () => {
    useSessionStore.setState((state) => {
      state.sessions = {};
      state.taskIdIndex = {};
    });
  },
};
