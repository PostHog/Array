import type { AgentEvent } from "@posthog/agent";
import { create } from "zustand";

interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

interface TodoGroup {
  type: "todo_group";
  todo: Todo;
  allTodos: Todo[];
  toolCalls: Array<{
    call: Extract<AgentEvent, { type: "tool_call" }>;
    result?: Extract<AgentEvent, { type: "tool_result" }>;
    index: number;
  }>;
  timestamp: number;
  todoWriteIndex: number;
}

interface StandaloneEvent {
  type: "standalone";
  event: AgentEvent;
  index: number;
  toolResult?: Extract<AgentEvent, { type: "tool_result" }>;
}

type ProcessedItem = TodoGroup | StandaloneEvent;

interface LogsStore {
  viewMode: "pretty" | "raw";
  highlightedIndex: number | null;
  expandAll: boolean;
  logs: AgentEvent[];
  setViewMode: (mode: "pretty" | "raw") => void;
  setHighlightedIndex: (index: number | null) => void;
  setExpandAll: (expand: boolean) => void;
  setLogs: (logs: AgentEvent[]) => void;
}

interface LogsSelectors {
  processedLogs: ProcessedItem[];
}

export const useLogsStore = create<LogsStore>((set) => ({
  viewMode: "pretty",
  highlightedIndex: null,
  expandAll: false,
  logs: [],
  setViewMode: (mode) => set({ viewMode: mode }),
  setHighlightedIndex: (index) => set({ highlightedIndex: index }),
  setExpandAll: (expand) => set({ expandAll: expand }),
  setLogs: (logs) => set({ logs }),
}));

export const useLogsSelectors = (): LogsSelectors => {
  const logs = useLogsStore((state) => state.logs);

  const processedLogs = (() => {
    const resultMap = new Map<
      string,
      Extract<AgentEvent, { type: "tool_result" }>
    >();

    for (const log of logs) {
      if (log.type === "tool_result") {
        resultMap.set(
          log.callId,
          log as Extract<AgentEvent, { type: "tool_result" }>,
        );
      }
    }

    const processed: ProcessedItem[] = [];
    let currentTodo: Todo | null = null;
    let currentAllTodos: Todo[] = [];
    let currentTodoTimestamp: number | null = null;
    let currentTodoWriteIndex: number | null = null;
    let currentToolCalls: Array<{
      call: Extract<AgentEvent, { type: "tool_call" }>;
      result?: Extract<AgentEvent, { type: "tool_result" }>;
      index: number;
    }> = [];

    const flushCurrentTodo = (finalStatus?: "completed" | "pending") => {
      if (
        currentTodo &&
        currentTodoTimestamp &&
        currentTodoWriteIndex !== null &&
        currentToolCalls.length > 0
      ) {
        const todoToFlush = finalStatus
          ? { ...currentTodo, status: finalStatus }
          : currentTodo;
        processed.push({
          type: "todo_group",
          todo: todoToFlush,
          allTodos: currentAllTodos,
          toolCalls: [...currentToolCalls],
          timestamp: currentTodoTimestamp,
          todoWriteIndex: currentTodoWriteIndex,
        });
        currentToolCalls = [];
      }
    };

    for (let index = 0; index < logs.length; index++) {
      const log = logs[index];

      if (log.type === "tool_call" && log.toolName === "TodoWrite") {
        const args = log.args as { todos?: Todo[] };
        const todos = args.todos || [];

        if (currentTodo) {
          const previousTodoInList = todos.find(
            (t) =>
              t.content === currentTodo?.content ||
              t.activeForm === currentTodo?.activeForm,
          );
          if (previousTodoInList && previousTodoInList.status === "completed") {
            flushCurrentTodo("completed");
          } else {
            flushCurrentTodo();
          }
        }

        const inProgressTodo = todos.find((t) => t.status === "in_progress");

        if (inProgressTodo) {
          currentTodo = inProgressTodo;
          currentAllTodos = todos;
          currentTodoTimestamp = log.ts;
          currentTodoWriteIndex = index;
        } else {
          currentTodo = null;
          currentAllTodos = [];
          currentTodoTimestamp = null;
          currentTodoWriteIndex = null;
        }
      } else if (log.type === "tool_call") {
        const toolCall = log as Extract<AgentEvent, { type: "tool_call" }>;
        const matchedResult = resultMap.get(toolCall.callId);

        if (currentTodo) {
          currentToolCalls.push({
            call: toolCall,
            result: matchedResult,
            index,
          });
        } else {
          processed.push({
            type: "standalone",
            event: log,
            index,
            toolResult: matchedResult,
          });
        }
      } else if (log.type === "tool_result") {
        // Skip tool results as they're matched with tool calls
      } else {
        processed.push({
          type: "standalone",
          event: log,
          index,
        });
      }
    }

    flushCurrentTodo();

    return processed;
  })();

  return {
    processedLogs,
  };
};
