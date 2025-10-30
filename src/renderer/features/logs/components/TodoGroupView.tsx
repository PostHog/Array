import { MessageChunkView } from "@features/logs/components/MessageChunkView";
import { ToolExecutionView } from "@features/logs/components/ToolExecutionView";
import {
  CaretDown as CaretDownIcon,
  CaretRight as CaretRightIcon,
  Check as CheckIcon,
  Circle as CircleIcon,
  CircleNotch as CircleNotchIcon,
} from "@phosphor-icons/react";
import type { AgentNotification } from "@posthog/agent";
import { Box, Code, ContextMenu } from "@radix-ui/themes";
import { getNotificationTimestamp } from "@utils/notification-helpers";
import { formatTimestamp } from "@utils/time";
import { useState } from "react";

interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
  priority?: "high" | "medium" | "low";
}

interface TodoGroupViewProps {
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
  onJumpToRaw?: (index: number) => void;
  forceExpanded?: boolean;
  planNumber?: number;
  totalPlans?: number;
  todoStepNumber?: number;
  totalTodos?: number;
}

function calculateTodoDuration(
  toolCalls: Array<{
    initialCall: AgentNotification;
    updates: AgentNotification[];
  }>,
): number | undefined {
  if (toolCalls.length === 0) return undefined;

  // Extract timestamp from first tool call
  const firstToolCall = toolCalls[0].initialCall;
  const firstToolStart = getNotificationTimestamp(firstToolCall);
  if (!firstToolStart) return undefined;

  // Extract timestamp from last tool update
  const lastToolUpdates = toolCalls[toolCalls.length - 1].updates;
  if (lastToolUpdates.length === 0) return undefined;

  const lastUpdate = lastToolUpdates[lastToolUpdates.length - 1];
  const lastToolEnd = getNotificationTimestamp(lastUpdate);
  if (!lastToolEnd) return undefined;

  return lastToolEnd - firstToolStart;
}

export function TodoGroupView({
  todo,
  allTodos,
  toolCalls,
  messageChunks,
  timestamp,
  todoWriteIndex,
  onJumpToRaw,
  forceExpanded = false,
  todoStepNumber,
  totalTodos,
}: TodoGroupViewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const expanded = forceExpanded || isExpanded;

  const statusColor =
    todo.status === "completed"
      ? "green"
      : todo.status === "in_progress"
        ? "blue"
        : "gray";

  const statusIcon =
    todo.status === "completed" ? (
      <CheckIcon size={14} weight="bold" />
    ) : todo.status === "in_progress" ? (
      <CircleNotchIcon size={14} className="animate-spin" />
    ) : (
      <CircleIcon size={14} />
    );

  const durationMs = calculateTodoDuration(toolCalls);
  const durationSeconds =
    durationMs !== undefined ? (durationMs / 1000).toFixed(2) : undefined;

  const isDev = import.meta.env.DEV;

  return (
    <Box mb="3">
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <Box className="overflow-hidden rounded-3 border border-accent-6">
            <Box
              className="flex cursor-pointer items-center gap-2 border-accent-6 border-b bg-gray-2 px-3 py-2 hover:bg-gray-3"
              onClick={() => setIsExpanded(!isExpanded)}
              style={{ alignItems: "center" }}
            >
              <Box
                style={{
                  display: "flex",
                  alignItems: "center",
                  color: "var(--gray-11)",
                }}
              >
                {expanded ? (
                  <CaretDownIcon size={14} />
                ) : (
                  <CaretRightIcon size={14} />
                )}
              </Box>
              <Box
                style={{
                  display: "flex",
                  alignItems: "center",
                  color: `var(--${statusColor}-11)`,
                }}
              >
                {statusIcon}
              </Box>
              <Code
                size="1"
                color="gray"
                variant="ghost"
                style={{ display: "flex", alignItems: "center" }}
              >
                {formatTimestamp(timestamp)}
              </Code>
              {todoStepNumber !== undefined && totalTodos !== undefined && (
                <Code
                  size="1"
                  variant="soft"
                  style={{ display: "flex", alignItems: "center" }}
                >
                  {todoStepNumber}/{totalTodos}
                </Code>
              )}
              <Code
                size="2"
                variant="ghost"
                className="flex-1"
                style={{ display: "flex", alignItems: "center" }}
              >
                {todo.content}
              </Code>
              {toolCalls.length > 0 && (
                <Code
                  size="1"
                  color="gray"
                  variant="ghost"
                  style={{ display: "flex", alignItems: "center" }}
                >
                  {toolCalls.length} {toolCalls.length === 1 ? "tool" : "tools"}
                </Code>
              )}
              {durationSeconds !== undefined && (
                <Code
                  size="1"
                  color="gray"
                  variant="ghost"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginLeft: "auto",
                  }}
                >
                  {durationSeconds}s
                </Code>
              )}
            </Box>
          </Box>
        </ContextMenu.Trigger>
        <ContextMenu.Content>
          {isDev && <ContextMenu.Label>TodoGroupView</ContextMenu.Label>}
          <ContextMenu.Item onClick={() => onJumpToRaw?.(todoWriteIndex)}>
            Jump to raw source
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
      {expanded && (
        <Box
          style={{
            borderLeft: "2px solid var(--gray-6)",
            paddingLeft: "1rem",
            marginLeft: "1rem",
            marginTop: "0.75rem",
          }}
        >
          {/* Render todo list */}
          {allTodos.length > 0 && (
            <Box mb="3" className="space-y-1">
              {allTodos.map((todoItem, i) => {
                const color =
                  todoItem.status === "completed"
                    ? "green"
                    : todoItem.status === "in_progress"
                      ? "blue"
                      : "gray";

                const icon =
                  todoItem.status === "completed"
                    ? "✓"
                    : todoItem.status === "in_progress"
                      ? "▶"
                      : "○";

                return (
                  <Box
                    key={`${todoItem.content}-${i}`}
                    className="flex items-start gap-2"
                  >
                    <Code size="1" color={color} variant="ghost">
                      {icon}
                    </Code>
                    <Code
                      size="1"
                      color={color}
                      variant="ghost"
                      className="flex-1"
                    >
                      {todoItem.content}
                    </Code>
                  </Box>
                );
              })}
            </Box>
          )}
          {/* Render tool calls and message chunks in chronological order */}
          {[
            ...toolCalls.map((tc) => ({
              type: "tool" as const,
              data: tc,
              index: tc.index,
            })),
            ...messageChunks.map((mc) => ({
              type: "message" as const,
              data: mc,
              index: mc.startIndex,
            })),
          ]
            .sort((a, b) => a.index - b.index)
            .map((item, idx) => {
              if (item.type === "tool") {
                const toolCall = item.data;
                return (
                  <ToolExecutionView
                    key={`tool-${toolCall.index}-${idx}`}
                    initialCall={toolCall.initialCall}
                    updates={toolCall.updates}
                    forceExpanded={forceExpanded}
                    onJumpToRaw={onJumpToRaw}
                    index={toolCall.index}
                  />
                );
              } else {
                const messageChunk = item.data;
                const timestamp =
                  getNotificationTimestamp(messageChunk.chunks[0]) ??
                  Date.now();
                return (
                  <MessageChunkView
                    key={`message-${messageChunk.startIndex}-${idx}`}
                    chunks={messageChunk.chunks}
                    timestamp={timestamp}
                  />
                );
              }
            })}
        </Box>
      )}
    </Box>
  );
}
