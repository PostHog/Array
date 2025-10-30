import type { AgentNotification } from "@posthog/agent";
import { getNotificationTimestamp } from "@utils/notification-helpers";
import {
  getToolCallId,
  isMessageChunk,
  isPlan,
  isSessionNotification,
  isTerminalOutput,
  isToolCall,
  isToolCallUpdate,
} from "@utils/notification-type-guards";
import type {
  MessageChunkGroup,
  StandaloneEvent,
  TerminalOutput,
  TodoGroup,
  ToolCallGroup,
} from "./logsStore";

interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
  priority?: "high" | "medium" | "low";
}

interface ToolCallData {
  initialCall: AgentNotification;
  updates: AgentNotification[];
  startIndex: number;
}

export function extractPlanEntries(
  notification: AgentNotification,
): Todo[] | null {
  if (!isSessionNotification(notification)) return null;

  const update = notification.update as Record<string, unknown>;
  if (
    !("sessionUpdate" in update) ||
    update.sessionUpdate !== "plan" ||
    !("entries" in update) ||
    !Array.isArray(update.entries)
  ) {
    return null;
  }

  return update.entries as Todo[];
}

export function extractTerminalOutput(
  notification: AgentNotification,
): TerminalOutput | null {
  if (!isTerminalOutput(notification)) return null;

  if (
    !("params" in notification) ||
    !notification.params ||
    typeof notification.params !== "object"
  ) {
    return null;
  }

  const params = notification.params as Record<string, unknown>;

  if (!params.terminalId || typeof params.terminalId !== "string") {
    return null;
  }

  return {
    terminalId: params.terminalId,
    output: typeof params.output === "string" ? params.output : "",
    exitCode: typeof params.exitCode === "number" ? params.exitCode : undefined,
    isComplete: params.isComplete === true,
  };
}

export function buildToolCallMap(
  logs: AgentNotification[],
): Map<string, ToolCallData> {
  const toolCallMap = new Map<string, ToolCallData>();

  logs.forEach((notification, index) => {
    if (isToolCall(notification)) {
      const toolCallId = getToolCallId(notification);
      if (toolCallId) {
        if (!toolCallMap.has(toolCallId)) {
          toolCallMap.set(toolCallId, {
            initialCall: notification,
            updates: [],
            startIndex: index,
          });
        } else {
          const existing = toolCallMap.get(toolCallId);
          if (existing) {
            existing.initialCall = notification;
          }
        }
      }
    } else if (isToolCallUpdate(notification)) {
      const toolCallId = getToolCallId(notification);
      if (toolCallId && toolCallMap.has(toolCallId)) {
        toolCallMap.get(toolCallId)?.updates.push(notification);
      }
    }
  });

  return toolCallMap;
}

export function collectPlanNotifications(
  logs: AgentNotification[],
): Array<{ notification: AgentNotification; index: number }> {
  return logs
    .map((notification, index) => ({ notification, index }))
    .filter(({ notification }) => isPlan(notification));
}

export function countRenderablePlans(
  planNotifications: Array<{ notification: AgentNotification; index: number }>,
  logs: AgentNotification[],
): number {
  let renderablePlansCount = planNotifications.length;

  if (planNotifications.length > 0) {
    const lastPlanNotif = planNotifications[planNotifications.length - 1];
    const lastPlanEntries = extractPlanEntries(lastPlanNotif.notification);

    if (lastPlanEntries) {
      const allCompleted = lastPlanEntries.every(
        (e) => e.status === "completed",
      );
      const hasToolCallsAfter = logs
        .slice(lastPlanNotif.index + 1)
        .some(isToolCall);

      if (allCompleted && !hasToolCallsAfter) {
        renderablePlansCount--;
      }
    }
  }

  return renderablePlansCount;
}

export function collectToolCallsForPlan(
  logs: AgentNotification[],
  startIndex: number,
  nextPlanIndex: number | null,
  toolCallMap: Map<string, ToolCallData>,
  toolCallsInTodoGroups: Set<string>,
  processedToolCallIds: Set<string>,
): Array<{
  initialCall: AgentNotification;
  updates: AgentNotification[];
  index: number;
}> {
  const toolCalls: Array<{
    initialCall: AgentNotification;
    updates: AgentNotification[];
    index: number;
  }> = [];

  const endIndex = nextPlanIndex ?? logs.length;

  for (let j = startIndex + 1; j < endIndex; j++) {
    if (isToolCall(logs[j])) {
      const toolCallId = getToolCallId(logs[j]);
      if (
        toolCallId &&
        toolCallMap.has(toolCallId) &&
        !toolCallsInTodoGroups.has(toolCallId)
      ) {
        const toolCallData = toolCallMap.get(toolCallId);
        if (toolCallData) {
          toolCalls.push({
            initialCall: toolCallData.initialCall,
            updates: toolCallData.updates,
            index: j,
          });
          toolCallsInTodoGroups.add(toolCallId);
          processedToolCallIds.add(toolCallId);
        }
      }
    }
  }

  return toolCalls;
}

export function collectMessageChunksForPlan(
  logs: AgentNotification[],
  startIndex: number,
  nextPlanIndex: number | null,
  processedMessageChunkIndexes: Set<number>,
): Array<{ chunks: AgentNotification[]; startIndex: number }> {
  const messageChunks: Array<{
    chunks: AgentNotification[];
    startIndex: number;
  }> = [];
  const endIndex = nextPlanIndex ?? logs.length;

  let j = startIndex + 1;
  while (j < endIndex) {
    if (isMessageChunk(logs[j]) && !processedMessageChunkIndexes.has(j)) {
      const chunkGroup: AgentNotification[] = [logs[j]];
      const chunkStartIndex = j;
      processedMessageChunkIndexes.add(j);

      let k = j + 1;
      while (k < endIndex && isMessageChunk(logs[k]) && !isPlan(logs[k])) {
        chunkGroup.push(logs[k]);
        processedMessageChunkIndexes.add(k);
        k++;
      }

      messageChunks.push({
        chunks: chunkGroup,
        startIndex: chunkStartIndex,
      });
      j = k - 1;
    }
    j++;
  }

  return messageChunks;
}

export function mergeTodoEntries(
  entries: Todo[],
  nextEntries: Todo[] | null,
): Todo[] {
  if (!nextEntries) return entries;

  return entries.map((entry, entryIdx) => {
    const nextEntry = nextEntries[entryIdx];
    if (
      nextEntry &&
      nextEntry.content === entry.content &&
      nextEntry.status === "completed" &&
      entry.status !== "completed"
    ) {
      return { ...entry, status: "completed" as const };
    }
    return entry;
  });
}

export function getCurrentTodoWithRetroactiveCompletion(
  entries: Todo[],
  nextEntries: Todo[] | null,
): Todo {
  let currentTodo =
    entries.find((e) => e.status === "in_progress") || entries[0];

  if (currentTodo && nextEntries) {
    const currentTodoIndex = entries.findIndex(
      (e) => e.content === currentTodo.content,
    );
    if (currentTodoIndex !== -1 && nextEntries[currentTodoIndex]) {
      const nextEntry = nextEntries[currentTodoIndex];
      if (
        nextEntry.content === currentTodo.content &&
        nextEntry.status === "completed" &&
        currentTodo.status !== "completed"
      ) {
        currentTodo = { ...currentTodo, status: "completed" as const };
      }
    }
  }

  return currentTodo;
}

export function createTodoGroup(
  notification: AgentNotification,
  index: number,
  planIdx: number,
  renderablePlansCount: number,
  nextPlan: AgentNotification | null,
  logs: AgentNotification[],
  toolCallMap: Map<string, ToolCallData>,
  toolCallsInTodoGroups: Set<string>,
  processedToolCallIds: Set<string>,
  processedMessageChunkIndexes: Set<number>,
): TodoGroup | null {
  const entries = extractPlanEntries(notification);
  if (!entries || entries.length === 0) return null;

  const nextEntries = nextPlan ? extractPlanEntries(nextPlan) : null;
  const currentTodo = getCurrentTodoWithRetroactiveCompletion(
    entries,
    nextEntries,
  );
  const mergedEntries = mergeTodoEntries(entries, nextEntries);

  const nextPlanIdx = logs.findIndex((log, i) => i > index && isPlan(log));

  const toolCalls = collectToolCallsForPlan(
    logs,
    index,
    nextPlanIdx > -1 ? nextPlanIdx : null,
    toolCallMap,
    toolCallsInTodoGroups,
    processedToolCallIds,
  );

  const messageChunks = collectMessageChunksForPlan(
    logs,
    index,
    nextPlanIdx > -1 ? nextPlanIdx : null,
    processedMessageChunkIndexes,
  );

  const currentTodoIndex = entries.findIndex(
    (e) => e.content === currentTodo.content,
  );
  const todoStepNumber = currentTodoIndex >= 0 ? currentTodoIndex + 1 : 1;

  return {
    type: "todo_group",
    todo: currentTodo,
    allTodos: mergedEntries,
    toolCalls,
    messageChunks,
    timestamp: getNotificationTimestamp(notification) ?? Date.now(),
    todoWriteIndex: index,
    planNumber: planIdx + 1,
    totalPlans: renderablePlansCount,
    todoStepNumber,
    totalTodos: entries.length,
  };
}

export function createToolCallGroup(
  toolCallId: string,
  toolCallData: ToolCallData,
  startIndex: number,
): ToolCallGroup {
  return {
    type: "tool_call_group",
    toolCallId,
    initialCall: toolCallData.initialCall,
    updates: toolCallData.updates,
    startIndex,
  };
}

export function createMessageChunkGroup(
  notification: AgentNotification,
  startIndex: number,
  logs: AgentNotification[],
  processedMessageChunkIndexes: Set<number>,
): { group: MessageChunkGroup; nextIndex: number } {
  const chunks: AgentNotification[] = [notification];
  const timestamp = getNotificationTimestamp(notification) ?? Date.now();
  processedMessageChunkIndexes.add(startIndex);

  let j = startIndex + 1;
  while (j < logs.length && isMessageChunk(logs[j])) {
    chunks.push(logs[j]);
    processedMessageChunkIndexes.add(j);
    j++;
  }

  return {
    group: {
      type: "message_chunk_group",
      chunks,
      timestamp,
      startIndex,
    },
    nextIndex: j,
  };
}

export function createStandaloneEvent(
  notification: AgentNotification,
  index: number,
): StandaloneEvent {
  return {
    type: "standalone",
    event: notification,
    index,
  };
}
