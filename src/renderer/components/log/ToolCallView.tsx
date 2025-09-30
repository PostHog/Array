import { Box, Button, Code, Flex } from "@radix-ui/themes";
import { useState } from "react";

interface ToolCallViewProps {
  toolName: string;
  callId?: string;
  args?: unknown;
}

function stringify(value: unknown, maxLength = 2000): string {
  try {
    const s = JSON.stringify(value, null, 2);
    if (!s) return "";
    return s.length > maxLength ? `${s.slice(0, maxLength)}…` : s;
  } catch {
    const s = String(value ?? "");
    return s.length > maxLength ? `${s.slice(0, maxLength)}…` : s;
  }
}

export function ToolCallView({ toolName, callId, args }: ToolCallViewProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Box className="overflow-hidden rounded-3 border border-gray-6">
      <Flex align="center" justify="between" p="3" className="bg-gray-2">
        <Box>
          <Code size="2" weight="medium" variant="ghost">
            {toolName}
          </Code>
          {callId ? (
            <Code size="2" color="gray" variant="ghost" className="ml-2">
              [{callId}]
            </Code>
          ) : null}
        </Box>
        <Button
          size="1"
          variant="outline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Hide args" : "Show args"}
        </Button>
      </Flex>
      {expanded && args !== undefined && (
        <Code
          size="2"
          variant="outline"
          className="block overflow-x-auto whitespace-pre-wrap p-3"
        >
          {stringify(args)}
        </Code>
      )}
    </Box>
  );
}
