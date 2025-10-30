import { AgentNotificationRenderer } from "@features/logs/components/AgentNotificationRenderer";
import { MessageChunkView } from "@features/logs/components/MessageChunkView";
import { TodoGroupView } from "@features/logs/components/TodoGroupView";
import { ToolExecutionView } from "@features/logs/components/ToolExecutionView";
import {
  useLogsSelectors,
  useLogsStore,
} from "@features/logs/stores/logsStore";
import { useAutoScroll } from "@hooks/useAutoScroll";
import {
  CaretDown as CaretDownIcon,
  CaretUp as CaretUpIcon,
  Check as CheckIcon,
  Copy as CopyIcon,
  Trash as TrashIcon,
} from "@phosphor-icons/react";
import type { AgentNotification } from "@posthog/agent";
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
import { useEffect, useState } from "react";

interface LogViewProps {
  logs: AgentNotification[];
  isRunning: boolean;
  onClearLogs?: () => void;
}

export function LogView({ logs, isRunning, onClearLogs }: LogViewProps) {
  const viewMode = useLogsStore((state) => state.viewMode);
  const highlightedIndex = useLogsStore((state) => state.highlightedIndex);
  const setViewMode = useLogsStore((state) => state.setViewMode);
  const setHighlightedIndex = useLogsStore(
    (state) => state.setHighlightedIndex,
  );
  const setExpandAll = useLogsStore((state) => state.setExpandAll);
  const setLogs = useLogsStore((state) => state.setLogs);
  const [copied, setCopied] = useState(false);

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

  const handleCopyLogs = async () => {
    try {
      const logsText = logs
        .map((log) => JSON.stringify(log, null, 2))
        .join("\n\n");
      await window.electronAPI.clipboardWriteText(logsText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy logs:", error);
    }
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
            <Tooltip content={copied ? "Copied!" : "Copy logs"}>
              <IconButton
                size="2"
                variant="ghost"
                color={copied ? "green" : "gray"}
                onClick={handleCopyLogs}
              >
                {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
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
            {processedLogs.map((item) => {
              if (item.type === "message_chunk_group") {
                return (
                  <MessageChunkView
                    key={`message-group-${item.startIndex}`}
                    chunks={item.chunks}
                    timestamp={item.timestamp}
                  />
                );
              }
              if (item.type === "tool_call_group") {
                return (
                  <ToolExecutionView
                    key={`tool-call-${item.toolCallId}`}
                    initialCall={item.initialCall}
                    updates={item.updates}
                    index={item.startIndex}
                    onJumpToRaw={handleJumpToRaw}
                  />
                );
              }
              if (item.type === "todo_group") {
                return (
                  <TodoGroupView
                    key={`todo-group-${item.todoWriteIndex}`}
                    todo={item.todo}
                    allTodos={item.allTodos}
                    toolCalls={item.toolCalls}
                    messageChunks={item.messageChunks}
                    timestamp={item.timestamp}
                    todoWriteIndex={item.todoWriteIndex}
                    onJumpToRaw={handleJumpToRaw}
                    planNumber={item.planNumber}
                    totalPlans={item.totalPlans}
                    todoStepNumber={item.todoStepNumber}
                    totalTodos={item.totalTodos}
                  />
                );
              }
              if (item.type === "standalone") {
                return (
                  <AgentNotificationRenderer
                    key={`notification-${item.index}`}
                    notification={item.event}
                    index={item.index}
                  />
                );
              }
              return null;
            })}
          </Box>
        ) : (
          <Box>
            {logs.map((notification, index) => {
              // Extract timestamp from notification
              const ts =
                "params" in notification && "timestamp" in notification.params
                  ? notification.params.timestamp
                  : Date.now();
              const timestamp = new Date(ts).toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });
              const isHighlighted = highlightedIndex === index;

              // Generate stable key from notification content
              const notificationKey = (() => {
                if ("sessionId" in notification) {
                  const sessionId = notification.sessionId as string;
                  const update =
                    "update" in notification ? notification.update : {};
                  const toolCallId =
                    update &&
                    typeof update === "object" &&
                    "toolCallId" in update
                      ? (update as { toolCallId?: string }).toolCallId
                      : undefined;
                  return toolCallId
                    ? `${sessionId}-${toolCallId}`
                    : `${sessionId}-${index}`;
                }
                if ("method" in notification) {
                  return `${notification.method}-${ts}-${index}`;
                }
                return `notification-${ts}-${index}`;
              })();

              return (
                <Code
                  key={notificationKey}
                  id={`log-${index}`}
                  size="1"
                  variant="ghost"
                  className={`block whitespace-pre-wrap font-mono ${
                    isHighlighted ? "bg-yellow-3" : ""
                  }`}
                  style={{ marginBottom: "1rem" }}
                >
                  [{timestamp}] {JSON.stringify(notification, null, 2)}
                </Code>
              );
            })}
          </Box>
        )}
      </Box>
    </Flex>
  );
}
