import React, { useEffect, useRef } from 'react';
import { Flex, Box, Heading, Text } from '@radix-ui/themes';
import { LogEntry, formatTime } from '../types/log';
import { ToolCallView } from './log/ToolCallView';
import { DiffView } from './log/DiffView';
import { MetricView } from './log/MetricView';

interface LogViewProps {
  logs: Array<string | LogEntry>;
  isRunning: boolean;
}

export function LogView({ logs, isRunning }: LogViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (logs.length === 0 && !isRunning) {
    return (
      <Flex direction="column" align="center" justify="center" height="100%" p="8">
        <Flex direction="column" align="center" gap="2">
          <Text color="gray">No activity yet</Text>
          <Text size="2" color="gray">Run the task to see logs here</Text>
        </Flex>
      </Flex>
    );
  }

  return (
    <Flex direction="column" height="100%">
      <Box p="4" className="border-b border-gray-6">
        <Flex align="center" justify="between">
          <Heading size="3">Activity Log</Heading>
          {isRunning && (
            <Flex align="center" gap="2">
              <Box
                width="8px"
                height="8px"
                className="bg-green-9 rounded-full animate-pulse"
              />
              <Text size="2" color="gray">Running</Text>
            </Flex>
          )}
        </Flex>
      </Box>

      <Box
        ref={scrollRef}
        flexGrow="1"
        overflowY="auto"
        p="4"
        className="font-mono text-sm whitespace-pre-wrap"
      >
        {logs.map((log, index) => {
          // Backward compat for plain strings
          if (typeof log === 'string') {
            return (
              <Box key={index} >
                <Text color="gray" >
                  {new Date().toLocaleTimeString()}
                </Text>
                <Text>{log}</Text>
              </Box>
            );
          }
          // Structured entries
          switch (log.type) {
            case 'text':
              return (
                <Box key={index} mb="2">
                  <Text color="gray" mr="2">
                    {formatTime(log.ts)}
                  </Text>
                  <Text color={log.level === 'error' ? 'red' : undefined}>
                    {log.content}
                  </Text>
                </Box>
              );
            case 'status':
              return (
                <Box key={index} mb="2">
                  <Text color="gray" mr="2">
                    {formatTime(log.ts)}
                  </Text>
                  <Text>status: {log.phase}</Text>
                </Box>
              );
            case 'tool_call':
              return (
                <Box key={index} mb="2">
                  <Text size="1" color="gray" >
                    {formatTime(log.ts)} tool_call
                  </Text>
                  <ToolCallView toolName={log.toolName} callId={log.callId} args={log.args} />
                </Box>
              );
            case 'tool_result':
              return (
                <Box key={index} mb="2">
                  <Text size="1" color="gray" >
                    {formatTime(log.ts)} tool_result
                  </Text>
                  <ToolCallView toolName={log.toolName} callId={log.callId} args={log.result} />
                </Box>
              );
            case 'diff':
              return (
                <Box key={index} mb="2">
                  <Text size="1" color="gray" >
                    {formatTime(log.ts)} diff
                  </Text>
                  <DiffView file={log.file} patch={log.patch} added={log.summary?.added} removed={log.summary?.removed} />
                </Box>
              );
            case 'file_write':
              return (
                <Box key={index} mb="2">
                  <Text color="gray" mr="2">
                    {formatTime(log.ts)}
                  </Text>
                  <Text>file_write: {log.path}</Text>
                  {typeof log.bytes === 'number' && (
                    <Text color="gray"> ({log.bytes} bytes)</Text>
                  )}
                </Box>
              );
            case 'metric':
              return (
                <Box key={index} mb="2">
                  <Text size="1" color="gray" >
                    {formatTime(log.ts)} metric
                  </Text>
                  <MetricView keyName={log.key} value={log.value} unit={log.unit} />
                </Box>
              );
            case 'artifact':
              return (
                <Box key={index} mb="2">
                  <Text color="gray" mr="2">
                    {formatTime(log.ts)}
                  </Text>
                  <Text>artifact: {/* simple preview */}</Text>
                </Box>
              );
            default:
              return (
                <Box key={index} mb="2">
                  <Text color="gray" mr="2">
                    {new Date().toLocaleTimeString()}
                  </Text>
                  <Text>{JSON.stringify(log)}</Text>
                </Box>
              );
          }
        })}
      </Box>
    </Flex>
  );
}