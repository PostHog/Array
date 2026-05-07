import {
  getPostHogExecDisplay,
  isPostHogExecTool,
} from "@features/posthog-mcp/utils/posthog-exec-display";
import {
  compactInput,
  ExpandableIcon,
  ExpandedContentBox,
  formatInput,
  getContentText,
  StatusIndicators,
  stripCodeFences,
  ToolTitle,
  type ToolViewProps,
  truncateText,
  useToolCallStatus,
} from "@features/sessions/components/session-update/toolCallUtils";
import { Plugs } from "@phosphor-icons/react";
import { Box, Flex } from "@radix-ui/themes";
import { useState } from "react";
import { parseMcpToolKey } from "../utils/mcp-app-host-utils";

const POSTHOG_EXEC_INPUT_PREVIEW_MAX_LENGTH = 60;

interface McpToolViewProps extends ToolViewProps {
  mcpToolName: string;
}

export function McpToolView({
  toolCall,
  turnCancelled,
  turnComplete,
  mcpToolName,
  expanded = false,
}: McpToolViewProps) {
  const [isExpanded, setIsExpanded] = useState(expanded);
  const { status, rawInput, content } = toolCall;
  const { isLoading, isFailed, wasCancelled, isComplete } = useToolCallStatus(
    status,
    turnCancelled,
    turnComplete,
  );

  const { serverName: defaultServerName, toolName: defaultToolName } =
    parseMcpToolKey(mcpToolName);
  const posthogDisplay = isPostHogExecTool(mcpToolName)
    ? getPostHogExecDisplay(rawInput)
    : null;
  const serverName = posthogDisplay ? "posthog" : defaultServerName;
  const toolName = posthogDisplay?.label ?? defaultToolName;
  const inputPreview = posthogDisplay
    ? posthogDisplay.input
      ? truncateText(
          posthogDisplay.input,
          POSTHOG_EXEC_INPUT_PREVIEW_MAX_LENGTH,
        )
      : undefined
    : compactInput(rawInput);
  const fullInput = formatInput(rawInput);

  const output = stripCodeFences(getContentText(content) ?? "");
  const hasOutput = output.trim().length > 0;
  const isExpandable = !!fullInput || hasOutput;

  const handleClick = () => {
    if (isExpandable) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <Box
      className={`group py-0.5 ${isExpandable ? "cursor-pointer" : ""}`}
      onClick={handleClick}
    >
      <Flex gap="2">
        <Box className="shrink-0 pt-px">
          <ExpandableIcon
            icon={Plugs}
            isLoading={isLoading}
            isExpandable={isExpandable}
            isExpanded={isExpanded}
          />
        </Box>
        <Flex align="center" gap="1" wrap="wrap" className="min-w-0">
          <ToolTitle>
            <span className="text-gray-10">{serverName}</span>
            {" - "}
            {toolName}
            <span className="text-gray-10">{" (MCP)"}</span>
          </ToolTitle>
          {inputPreview && (
            <ToolTitle>
              <span className="text-accent-11">{inputPreview}</span>
            </ToolTitle>
          )}
          <StatusIndicators isFailed={isFailed} wasCancelled={wasCancelled} />
        </Flex>
      </Flex>

      {isExpanded && (
        <>
          {fullInput && <ExpandedContentBox>{fullInput}</ExpandedContentBox>}
          {isComplete && hasOutput && (
            <ExpandedContentBox>{output}</ExpandedContentBox>
          )}
        </>
      )}
    </Box>
  );
}
