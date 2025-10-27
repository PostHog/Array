import { LogEventRenderer } from "@features/logs/components/LogEventRenderer";
import { TodoGroupView } from "@features/logs/components/TodoGroupView";
import {
  useLogsSelectors,
  useLogsStore,
} from "@features/logs/stores/logsStore";
import { useAutoScroll } from "@hooks/useAutoScroll";
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
import { useEffect } from "react";

interface LogViewProps {
  logs: AgentEvent[];
  isRunning: boolean;
  onClearLogs?: () => void;
}

export function LogView({ logs, isRunning, onClearLogs }: LogViewProps) {
  const viewMode = useLogsStore((state) => state.viewMode);
  const highlightedIndex = useLogsStore((state) => state.highlightedIndex);
  const expandAll = useLogsStore((state) => state.expandAll);
  const setViewMode = useLogsStore((state) => state.setViewMode);
  const setHighlightedIndex = useLogsStore(
    (state) => state.setHighlightedIndex,
  );
  const setExpandAll = useLogsStore((state) => state.setExpandAll);
  const setLogs = useLogsStore((state) => state.setLogs);

  const { scrollRef } = useAutoScroll({
    contentLength: logs.length,
    viewMode,
  });

  useEffect(() => {
    setLogs(logs);
  }, [logs, setLogs]);

  const { processedLogs } = useLogsSelectors();

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
