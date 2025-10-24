import {
  CaretDown as CaretDownIcon,
  CaretUp as CaretUpIcon,
  Copy as CopyIcon,
  Trash as TrashIcon,
} from "@phosphor-icons/react";
import type { AgentEvent } from "@posthog/agent";
import {
  Box,
  Code,
  Flex,
  Heading,
  IconButton,
  SegmentedControl,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { LogEventRenderer } from "./log/LogEventRenderer";
import { TodoGroupView } from "./log/TodoGroupView";

interface LogViewProps {
  logs: AgentEvent[];
  isRunning: boolean;
  onClearLogs?: () => void;
}

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

export function LogView({ logs, isRunning, onClearLogs }: LogViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<"pretty" | "raw">("pretty");
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [expandAll, setExpandAll] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const scrollPositions = useRef<{ pretty: number; raw: number }>({
    pretty: 0,
    raw: 0,
  });

  // Process logs to group tool calls by active todo
  const processedLogs = useMemo(() => {
    // Build a map of callId -> tool_result event
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
        // Update status if we know the final status
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

        // Check if previous todo completed
        if (currentTodo) {
          const previousTodoInList = todos.find(
            (t) =>
              t.content === currentTodo?.content ||
              t.activeForm === currentTodo?.activeForm,
          );
          if (previousTodoInList && previousTodoInList.status === "completed") {
            // Flush with completed status
            flushCurrentTodo("completed");
          } else {
            // Flush without changing status (still in progress or moved to pending)
            flushCurrentTodo();
          }
        }

        // Extract the new in_progress todo
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
        // Regular tool call
        const toolCall = log as Extract<AgentEvent, { type: "tool_call" }>;
        const matchedResult = resultMap.get(toolCall.callId);

        if (currentTodo) {
          // Add to current todo group
          currentToolCalls.push({
            call: toolCall,
            result: matchedResult,
            index,
          });
        } else {
          // Standalone tool call (no active todo)
          processed.push({
            type: "standalone",
            event: log,
            index,
            toolResult: matchedResult,
          });
        }
      } else if (log.type === "tool_result") {
      } else {
        // All other events pass through as standalone
        processed.push({
          type: "standalone",
          event: log,
          index,
        });
      }
    }

    // Flush any remaining todo group
    flushCurrentTodo();

    return processed;
  }, [logs]);

  // Track scroll position and auto-scroll state
  useEffect(() => {
    const handleScroll = () => {
      if (scrollRef.current) {
        scrollPositions.current[viewMode] = scrollRef.current.scrollTop;

        // Check if user is near the bottom (within 100px)
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
        setAutoScroll(isNearBottom);
      }
    };

    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    scrollElement.addEventListener("scroll", handleScroll);
    return () => scrollElement.removeEventListener("scroll", handleScroll);
  }, [viewMode]);

  // Restore scroll position when view changes
  useEffect(() => {
    if (scrollRef.current) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollPositions.current[viewMode];
        }
      });
    }
  }, [viewMode]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current && autoScroll) {
      // Use requestAnimationFrame to ensure DOM is updated with new content
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [autoScroll]);

  if (logs.length === 0 && !isRunning) {
    return (
      <Flex
        direction="column"
        align="center"
        justify="center"
        height="100%"
        p="8"
      >
        <Flex direction="column" align="center" gap="2">
          <Text color="gray">No activity yet</Text>
        </Flex>
      </Flex>
    );
  }

  const handleCopyLogs = () => {
    const logsText = logs
      .map((log) => JSON.stringify(log, null, 2))
      .join("\n\n");
    navigator.clipboard.writeText(logsText);
  };

  const handleJumpToRaw = (index: number) => {
    setViewMode("raw");
    setHighlightedIndex(index);
    // Small delay to ensure the view has switched before scrolling
    setTimeout(() => {
      const element = document.getElementById(`log-${index}`);
      if (element && scrollRef.current) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
  };

  return (
    <Flex direction="column" height="100%">
      <Box p="4" className="border-gray-6 border-b">
        <Flex align="center" justify="between">
          <Heading size="3">Activity Log</Heading>
          <Flex align="center" gap="3">
            {viewMode === "pretty" && (
              <>
                <Tooltip content="Collapse all">
                  <IconButton
                    size="2"
                    variant="ghost"
                    color="gray"
                    onClick={() => setExpandAll(false)}
                  >
                    <CaretUpIcon size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip content="Expand all">
                  <IconButton
                    size="2"
                    variant="ghost"
                    color="gray"
                    onClick={() => setExpandAll(true)}
                  >
                    <CaretDownIcon size={16} />
                  </IconButton>
                </Tooltip>
              </>
            )}
            <Tooltip content="Copy logs">
              <IconButton
                size="2"
                variant="ghost"
                color="gray"
                onClick={handleCopyLogs}
              >
                <CopyIcon size={16} />
              </IconButton>
            </Tooltip>
            {onClearLogs && (
              <Tooltip content="Clear logs">
                <IconButton
                  size="2"
                  variant="ghost"
                  color="red"
                  onClick={onClearLogs}
                >
                  <TrashIcon size={16} />
                </IconButton>
              </Tooltip>
            )}
            <SegmentedControl.Root
              value={viewMode}
              onValueChange={(value) => setViewMode(value as "pretty" | "raw")}
            >
              <SegmentedControl.Item value="pretty">
                Formatted
              </SegmentedControl.Item>
              <SegmentedControl.Item value="raw">Raw</SegmentedControl.Item>
            </SegmentedControl.Root>
            {isRunning && (
              <Flex align="center" gap="2">
                <Box
                  width="8px"
                  height="8px"
                  className="animate-pulse rounded-full bg-green-9"
                />
                <Text size="2" color="gray">
                  Running
                </Text>
              </Flex>
            )}
            {!isRunning && logs.length > 0 && (
              <Flex align="center" gap="2">
                <Box
                  width="8px"
                  height="8px"
                  className="rounded-full bg-orange-9"
                />
                <Text size="2" color="gray">
                  Idle
                </Text>
              </Flex>
            )}
          </Flex>
        </Flex>
      </Box>
      <Box ref={scrollRef} flexGrow="1" overflowY="auto" p="4">
        {viewMode === "pretty" ? (
          <Box className="space-y-2">
            {processedLogs.map((processed, idx) => {
              if (processed.type === "todo_group") {
                const key = `todo-${processed.timestamp}-${idx}`;
                return (
                  <TodoGroupView
                    key={key}
                    todo={processed.todo}
                    allTodos={processed.allTodos}
                    toolCalls={processed.toolCalls}
                    timestamp={processed.timestamp}
                    todoWriteIndex={processed.todoWriteIndex}
                    onJumpToRaw={handleJumpToRaw}
                    forceExpanded={expandAll}
                  />
                );
              } else {
                const key = `${processed.event.type}-${processed.event.ts}-${processed.index}`;
                return (
                  <LogEventRenderer
                    key={key}
                    event={processed.event}
                    index={processed.index}
                    toolResult={processed.toolResult}
                    onJumpToRaw={handleJumpToRaw}
                    forceExpanded={expandAll}
                  />
                );
              }
            })}
          </Box>
        ) : (
          <Box>
            {logs.map((log, index) => {
              const timestamp = new Date(log.ts).toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });
              const isHighlighted = highlightedIndex === index;
              return (
                <Code
                  key={`${log.ts}-${index}`}
                  id={`log-${index}`}
                  size="1"
                  variant="ghost"
                  className={`block whitespace-pre-wrap font-mono ${
                    isHighlighted ? "bg-yellow-3" : ""
                  }`}
                  style={{ marginBottom: "1rem" }}
                >
                  [{timestamp}] {JSON.stringify(log, null, 2)}
                </Code>
              );
            })}
          </Box>
        )}
      </Box>
    </Flex>
  );
}
