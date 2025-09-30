import { TrashIcon } from "@radix-ui/react-icons";
import { Box, Code, Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import { useEffect, useRef } from "react";
import { formatTime, type LogEntry } from "../types/log";
import { DiffView } from "./log/DiffView";
import { MetricView } from "./log/MetricView";
import { ToolCallView } from "./log/ToolCallView";

interface LogViewProps {
  logs: Array<string | LogEntry>;
  isRunning: boolean;
  onClearLogs?: () => void;
}

export function LogView({ logs, isRunning, onClearLogs }: LogViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

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

  return (
    <Flex direction="column" height="100%">
      <Box p="4" className="border-gray-6 border-b">
        <Flex align="center" justify="between">
          <Heading size="3">Activity Log</Heading>
          <Flex align="center" gap="2">
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
            {logs.length > 0 && onClearLogs && (
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                onClick={onClearLogs}
                title="Clear logs"
              >
                <TrashIcon />
              </IconButton>
            )}
          </Flex>
        </Flex>
      </Box>

      <Box ref={scrollRef} flexGrow="1" overflowY="auto" p="4">
        {logs.map((log, index) => {
          const key =
            typeof log === "string"
              ? `str-${index}`
              : `${log.type}-${log.ts}-${index}`;

          // Backward compat for plain strings
          if (typeof log === "string") {
            return (
              <Box key={key} mb="2">
                <Code size="1" color="gray" variant="ghost">
                  {new Date().toLocaleTimeString()}
                </Code>
                <Code size="2" variant="ghost" className="ml-2">
                  {log}
                </Code>
              </Box>
            );
          }
          // Structured entries
          switch (log.type) {
            case "text":
              return (
                <Box key={key} mb="2">
                  <Code size="1" color="gray" variant="ghost">
                    {formatTime(log.ts)}
                  </Code>
                  <Code
                    size="2"
                    color={log.level === "error" ? "red" : undefined}
                    variant="ghost"
                    className="ml-2"
                  >
                    {log.content}
                  </Code>
                </Box>
              );
            case "status":
              return (
                <Box key={key} mb="2">
                  <Code size="1" color="gray" variant="ghost">
                    {formatTime(log.ts)}
                  </Code>
                  <Code size="2" variant="ghost" className="ml-2">
                    status: {log.phase}
                  </Code>
                </Box>
              );
            case "tool_call":
              return (
                <Box key={key} mb="3">
                  <Code size="1" color="gray" variant="ghost">
                    {formatTime(log.ts)} tool_call
                  </Code>
                  <Box mt="1">
                    <ToolCallView
                      toolName={log.toolName}
                      callId={log.callId}
                      args={log.args}
                    />
                  </Box>
                </Box>
              );
            case "tool_result":
              return (
                <Box key={key} mb="3">
                  <Code size="1" color="gray" variant="ghost">
                    {formatTime(log.ts)} tool_result
                  </Code>
                  <Box mt="1">
                    <ToolCallView
                      toolName={log.toolName}
                      callId={log.callId}
                      args={log.result}
                    />
                  </Box>
                </Box>
              );
            case "diff":
              return (
                <Box key={key} mb="3">
                  <Code size="1" color="gray" variant="ghost">
                    {formatTime(log.ts)} diff
                  </Code>
                  <Box mt="1">
                    <DiffView
                      file={log.file}
                      patch={log.patch}
                      added={log.summary?.added}
                      removed={log.summary?.removed}
                    />
                  </Box>
                </Box>
              );
            case "file_write":
              return (
                <Box key={key} mb="2">
                  <Code size="1" color="gray" variant="ghost">
                    {formatTime(log.ts)}
                  </Code>
                  <Code size="2" variant="ghost" className="ml-2">
                    file_write: {log.path}
                    {typeof log.bytes === "number" && (
                      <Code size="1" color="gray" variant="ghost">
                        {" "}
                        ({log.bytes} bytes)
                      </Code>
                    )}
                  </Code>
                </Box>
              );
            case "metric":
              return (
                <Box key={key} mb="3">
                  <Code size="1" color="gray" variant="ghost">
                    {formatTime(log.ts)} metric
                  </Code>
                  <Box mt="1">
                    <MetricView
                      keyName={log.key}
                      value={log.value}
                      unit={log.unit}
                    />
                  </Box>
                </Box>
              );
            case "artifact":
              return (
                <Box key={key} mb="2">
                  <Code size="1" color="gray" variant="ghost">
                    {formatTime(log.ts)}
                  </Code>
                  <Code size="2" variant="ghost" className="ml-2">
                    artifact
                  </Code>
                </Box>
              );
            default:
              return (
                <Box key={key} mb="2">
                  <Code size="1" color="gray" variant="ghost">
                    {new Date().toLocaleTimeString()}
                  </Code>
                  <Code size="2" variant="ghost" className="ml-2">
                    {JSON.stringify(log)}
                  </Code>
                </Box>
              );
          }
        })}
      </Box>
    </Flex>
  );
}
