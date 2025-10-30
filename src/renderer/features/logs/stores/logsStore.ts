import type { AgentNotification } from "@posthog/agent";
import {
  getToolCallId,
  isMessageChunk,
  isPlan,
  isTerminalOutput,
  isToolCall,
  isToolCallUpdate,
} from "@utils/notification-type-guards";
import { create } from "zustand";
import {
  buildToolCallMap,
  collectPlanNotifications,
  countRenderablePlans,
  createMessageChunkGroup,
  createStandaloneEvent,
  createTodoGroup,
  createToolCallGroup,
  extractTerminalOutput,
} from "./logs-processor";

interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
  priority?: "high" | "medium" | "low";
}

export interface TodoGroup {
  type: "todo_group";
  todo: Todo;
  allTodos: Todo[];
  toolCalls: Array<{
    initialCall: AgentNotification;
    updates: AgentNotification[];
    index: number;
  }>;
  messageChunks: Array<{
    chunks: AgentNotification[];
    startIndex: number;
  }>;
  timestamp: number;
  todoWriteIndex: number;
  planNumber: number;
  totalPlans: number;
  todoStepNumber: number;
  totalTodos: number;
}

export interface StandaloneEvent {
  type: "standalone";
  event: AgentNotification;
  index: number;
  toolResult?: unknown;
}

export interface MessageChunkGroup {
  type: "message_chunk_group";
  chunks: AgentNotification[];
  timestamp: number;
  startIndex: number;
}

export interface ToolCallGroup {
  type: "tool_call_group";
  toolCallId: string;
  initialCall: AgentNotification;
  updates: AgentNotification[];
  startIndex: number;
}

export type ProcessedItem =
  | TodoGroup
  | StandaloneEvent
  | MessageChunkGroup
  | ToolCallGroup;

export interface TerminalOutput {
  terminalId: string;
  output: string;
  exitCode?: number;
  isComplete: boolean;
}

interface LogsStore {
  viewMode: "pretty" | "raw";
  highlightedIndex: number | null;
  expandAll: boolean;
  logs: AgentNotification[];
  terminalOutputs: Map<string, TerminalOutput>;
  setViewMode: (mode: "pretty" | "raw") => void;
  setHighlightedIndex: (index: number | null) => void;
  setExpandAll: (expand: boolean) => void;
  setLogs: (logs: AgentNotification[]) => void;
  setTerminalOutput: (terminalId: string, output: TerminalOutput) => void;
  getTerminalOutput: (terminalId: string) => TerminalOutput | undefined;
}

interface LogsSelectors {
  processedLogs: ProcessedItem[];
}

export const useLogsStore = create<LogsStore>((set, get) => ({
  viewMode: "pretty",
  highlightedIndex: null,
  expandAll: false,
  logs: [],
  terminalOutputs: new Map(),
  setViewMode: (mode) => set({ viewMode: mode }),
  setHighlightedIndex: (index) => set({ highlightedIndex: index }),
  setExpandAll: (expand) => set({ expandAll: expand }),
  setLogs: (logs) => set({ logs }),
  setTerminalOutput: (terminalId, output) => {
    const terminalOutputs = new Map(get().terminalOutputs);
    terminalOutputs.set(terminalId, output);
    set({ terminalOutputs });
  },
  getTerminalOutput: (terminalId) => get().terminalOutputs.get(terminalId),
}));

export const useLogsSelectors = (): LogsSelectors => {
  const logs = useLogsStore((state) => state.logs);
  const setTerminalOutput = useLogsStore((state) => state.setTerminalOutput);

  const processedLogs: ProcessedItem[] = [];
  const toolCallMap = buildToolCallMap(logs);
  const processedToolCallIds = new Set<string>();
  const toolCallsInTodoGroups = new Set<string>();
  const processedMessageChunkIndexes = new Set<number>();

  // Process terminal outputs and collect plan notifications
  logs.forEach((notification) => {
    const terminalOutput = extractTerminalOutput(notification);
    if (terminalOutput) {
      setTerminalOutput(terminalOutput.terminalId, terminalOutput);
    }
  });

  const planNotifications = collectPlanNotifications(logs);
  const renderablePlansCount = countRenderablePlans(planNotifications, logs);

  // Main processing loop
  let i = 0;
  while (i < logs.length) {
    const notification = logs[i];

    // Handle plan notifications (TodoGroups)
    if (isPlan(notification)) {
      const planIdx = planNotifications.findIndex((p) => p.index === i);
      const nextPlan =
        planIdx >= 0 && planIdx < planNotifications.length - 1
          ? planNotifications[planIdx + 1].notification
          : null;

      const todoGroup = createTodoGroup(
        notification,
        i,
        planIdx,
        renderablePlansCount,
        nextPlan,
        logs,
        toolCallMap,
        toolCallsInTodoGroups,
        processedToolCallIds,
        processedMessageChunkIndexes,
      );

      if (todoGroup) {
        const isLastPlan = planIdx === planNotifications.length - 1;
        const allCompleted = todoGroup.allTodos.every(
          (e) => e.status === "completed",
        );

        if (!(isLastPlan && allCompleted && todoGroup.toolCalls.length === 0)) {
          processedLogs.push(todoGroup);
        }
      }

      i++;
      continue;
    }

    // Handle standalone tool calls
    if (isToolCall(notification)) {
      const toolCallId = getToolCallId(notification);
      if (
        toolCallId &&
        toolCallMap.has(toolCallId) &&
        !processedToolCallIds.has(toolCallId) &&
        !toolCallsInTodoGroups.has(toolCallId)
      ) {
        const toolCallData = toolCallMap.get(toolCallId);
        if (toolCallData) {
          processedLogs.push(createToolCallGroup(toolCallId, toolCallData, i));
          processedToolCallIds.add(toolCallId);
        }
      }
      i++;
      continue;
    }

    // Skip tool call updates (grouped with initial calls)
    if (isToolCallUpdate(notification)) {
      i++;
      continue;
    }

    // Handle message chunks
    if (isMessageChunk(notification) && !processedMessageChunkIndexes.has(i)) {
      const { group, nextIndex } = createMessageChunkGroup(
        notification,
        i,
        logs,
        processedMessageChunkIndexes,
      );
      processedLogs.push(group);
      i = nextIndex;
      continue;
    }

    // Skip terminal outputs (stored in Map, not rendered)
    if (isTerminalOutput(notification)) {
      i++;
      continue;
    }

    // Handle all other notifications as standalone events
    processedLogs.push(createStandaloneEvent(notification, i));
    i++;
  }

  return { processedLogs };
};
