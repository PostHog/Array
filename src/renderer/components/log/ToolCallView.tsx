import React, { useState } from 'react';
import { Box, Flex, Button, Code } from '@radix-ui/themes';

interface ToolCallViewProps {
  toolName: string;
  callId?: string;
  args?: unknown;
}

function stringify(value: unknown, maxLength = 2000): string {
  try {
    const s = JSON.stringify(value, null, 2);
    if (!s) return '';
    return s.length > maxLength ? s.slice(0, maxLength) + '…' : s;
  } catch {
    const s = String(value ?? '');
    return s.length > maxLength ? s.slice(0, maxLength) + '…' : s;
  }
}

export function ToolCallView({ toolName, callId, args }: ToolCallViewProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Box className="border border-gray-6 rounded-3 overflow-hidden">
      <Flex align="center" justify="between" p="3" className="bg-gray-2">
        <Box>
          <Code size="2" weight="medium" variant="ghost">{toolName}</Code>
          {callId ? <Code size="2" color="gray" variant="ghost" className="ml-2">[{callId}]</Code> : null}
        </Box>
        <Button
          size="1"
          variant="outline"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? 'Hide args' : 'Show args'}
        </Button>
      </Flex>
      {expanded && args !== undefined && (
        <Code size="2" variant="outline" className="block p-3 whitespace-pre-wrap overflow-x-auto">
          {stringify(args)}
        </Code>
      )}
    </Box>
  );
}


