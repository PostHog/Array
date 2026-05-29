import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  Brain,
} from "@phosphor-icons/react";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { useState } from "react";
import { ToolRow } from "./ToolRow";
import {
  getContentText,
  LoadingIcon,
  type ToolViewProps,
  useToolCallStatus,
} from "./toolCallUtils";

const COLLAPSED_LINE_COUNT = 5;

export function ThinkToolView({
  toolCall,
  turnCancelled,
  turnComplete,
}: ToolViewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { status, content, title } = toolCall;
  const { isLoading, isFailed, wasCancelled } = useToolCallStatus(
    status,
    turnCancelled,
    turnComplete,
  );

  const thinkingContent = getContentText(content) ?? "";
  const hasContent = thinkingContent.trim().length > 0;
  const contentLines = thinkingContent.split("\n");
  const isCollapsible = contentLines.length > COLLAPSED_LINE_COUNT;
  const hiddenLineCount = contentLines.length - COLLAPSED_LINE_COUNT;
  const displayedContent = isExpanded
    ? thinkingContent
    : contentLines.slice(0, COLLAPSED_LINE_COUNT).join("\n");

  if (!hasContent) {
    return (
      <ToolRow
        icon={Brain}
        isLoading={isLoading}
        isFailed={isFailed}
        wasCancelled={wasCancelled}
      >
        {title || "Thinking"}
      </ToolRow>
    );
  }

  return (
    <Box className="my-2 max-w-4xl overflow-hidden rounded-lg border border-gray-6 bg-gray-1">
      <Flex align="center" justify="between" className="px-3 py-2">
        <Flex align="center" gap="2">
          <LoadingIcon
            icon={Brain}
            isLoading={isLoading}
            className="text-gray-10"
          />
          <Text className="text-[13px] text-gray-10">
            {title || "Thinking"}
          </Text>
        </Flex>
        {isCollapsible && (
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ArrowsInSimpleIcon size={12} />
            ) : (
              <ArrowsOutSimpleIcon size={12} />
            )}
          </IconButton>
        )}
      </Flex>

      <Box className="border-gray-6 border-t px-3 py-2">
        <Text asChild className="text-[13px] text-gray-11">
          <pre className="m-0 whitespace-pre-wrap break-all font-mono">
            {displayedContent}
          </pre>
        </Text>
        {isCollapsible && !isExpanded && (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="mt-1 flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-gray-10 hover:text-gray-12"
          >
            <Text className="text-[13px]">+{hiddenLineCount} more lines</Text>
          </button>
        )}
      </Box>
    </Box>
  );
}
