import { ActionSelector } from "@components/ActionSelector";
import { parseMcpToolKey } from "@features/mcp-apps/utils/mcp-app-host-utils";
import {
  formatPosthogExecBody,
  getPostHogExecDisplay,
  isPostHogExecTool,
} from "@features/posthog-mcp/utils/posthog-exec-display";
import { formatInput } from "@features/sessions/components/session-update/toolCallUtils";
import { Box, Code } from "@radix-ui/themes";
import { DefaultPermission } from "./DefaultPermission";
import { type BasePermissionProps, toSelectorOptions } from "./types";

export function McpPermission({
  toolCall,
  options,
  onSelect,
  onCancel,
}: BasePermissionProps) {
  const mcpToolName = (
    toolCall._meta as { claudeCode?: { toolName?: string } } | undefined
  )?.claudeCode?.toolName;

  if (!mcpToolName) {
    return (
      <DefaultPermission
        toolCall={toolCall}
        options={options}
        onSelect={onSelect}
        onCancel={onCancel}
      />
    );
  }

  const { serverName: defaultServerName, toolName: defaultToolName } =
    parseMcpToolKey(mcpToolName);
  const posthogDisplay = isPostHogExecTool(mcpToolName)
    ? getPostHogExecDisplay(toolCall.rawInput)
    : null;
  const serverName = posthogDisplay ? "posthog" : defaultServerName;
  const toolName = posthogDisplay?.label ?? defaultToolName;
  const fullInput = posthogDisplay
    ? formatPosthogExecBody(posthogDisplay.input)
    : formatInput(toolCall.rawInput);

  return (
    <ActionSelector
      title={
        <>
          <span className="text-gray-10">{serverName}</span>
          {" - "}
          {toolName}
          <span className="text-gray-10">{" (MCP)"}</span>
        </>
      }
      pendingAction={
        fullInput ? (
          <Box className="max-h-[30vh] overflow-auto">
            <Code
              variant="ghost"
              className="whitespace-pre-wrap break-all text-[13px]"
            >
              {fullInput}
            </Code>
          </Box>
        ) : undefined
      }
      question="Do you want to proceed?"
      options={toSelectorOptions(options)}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
