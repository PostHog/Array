import { ToolExecutionView } from "@features/logs/components/ToolExecutionView";
import {
  CaretDown as CaretDownIcon,
  CaretRight as CaretRightIcon,
  Check as CheckIcon,
  Circle as CircleIcon,
  CircleNotch as CircleNotchIcon,
} from "@phosphor-icons/react";
import type { AgentEvent } from "@posthog/agent";
import { Box, Code, ContextMenu } from "@radix-ui/themes";
import { formatTimestamp } from "@utils/time";
import { useState } from "react";
import { IS_DEV } from "@/constants/environment";

interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

interface TodoGroupViewProps {
  todo: Todo;
  allTodos: Todo[];
  toolCalls: Array<{
    call: Extract<AgentEvent, { type: "tool_call" }>;
    result?: Extract<AgentEvent, { type: "tool_result" }>;
    index: number;
  }>;
  timestamp: number;
  todoWriteIndex: number;
  onJumpToRaw?: (index: number) => void;
  forceExpanded?: boolean;
}

function calculateTodoDuration(
  toolCalls: Array<{
    call: Extract<AgentEvent, { type: "tool_call" }>;
    result?: Extract<AgentEvent, { type: "tool_result" }>;
  }>,
): number | undefined {
  if (toolCalls.length === 0) return undefined;

  const firstToolStart = toolCalls[0].call.ts;
  const lastToolResult = toolCalls[toolCalls.length - 1].result;

  if (!lastToolResult) return undefined;

  return lastToolResult.ts - firstToolStart;
}

export function TodoGroupView({
  todo,
  allTodos,
  toolCalls,
  timestamp,
  todoWriteIndex,
  onJumpToRaw,
  forceExpanded = false,
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

  // Find the current todo's index in the allTodos array
  const currentTodoIndex = allTodos.findIndex(
    (t) => t.content === todo.content && t.activeForm === todo.activeForm,
  );
  const todoPosition = currentTodoIndex !== -1 ? currentTodoIndex + 1 : null;

  const durationMs = calculateTodoDuration(toolCalls);
  const durationSeconds =
    durationMs !== undefined ? (durationMs / 1000).toFixed(2) : undefined;

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
              {todoPosition !== null && (
                <Code
                  size="1"
                  variant="soft"
                  style={{ display: "flex", alignItems: "center" }}
                >
                  ({todoPosition}/{allTodos.length})
                </Code>
              )}
              <Code
                size="2"
                variant="ghost"
                className="flex-1"
                style={{ display: "flex", alignItems: "center" }}
              >
                {todo.status === "in_progress" ? todo.activeForm : todo.content}
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
          {IS_DEV && <ContextMenu.Label>TodoGroupView</ContextMenu.Label>}
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
                      {todoItem.status === "in_progress"
                        ? todoItem.activeForm
                        : todoItem.content}
                    </Code>
                  </Box>
                );
              })}
            </Box>
          )}
          {/* Render tool calls */}
          {toolCalls.map((toolCall, idx) => (
            <ToolExecutionView
              key={`${toolCall.call.callId}-${idx}`}
              call={toolCall.call}
              result={toolCall.result}
              forceExpanded={forceExpanded}
              onJumpToRaw={onJumpToRaw}
              index={toolCall.index}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
