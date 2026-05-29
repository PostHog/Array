import { Brain } from "@phosphor-icons/react";
import { Box, Text } from "@radix-ui/themes";
import { memo, useState } from "react";
import { ExpandableIcon } from "./toolCallUtils";

interface ThoughtViewProps {
  content: string;
  isLoading: boolean;
}

const COLLAPSED_LINE_COUNT = 5;

export const ThoughtView = memo(function ThoughtView({
  content,
  isLoading,
}: ThoughtViewProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const hasContent = content.trim().length > 0;
  const contentLines = content.split("\n");
  const isCollapsible =
    hasContent && contentLines.length > COLLAPSED_LINE_COUNT;
  const hiddenLineCount = contentLines.length - COLLAPSED_LINE_COUNT;
  const displayedContent = isExpanded
    ? content
    : contentLines.slice(0, COLLAPSED_LINE_COUNT).join("\n");

  return (
    <Box>
      <button
        type="button"
        onClick={() => hasContent && setIsExpanded((v) => !v)}
        className={`group flex items-center gap-2 border-none bg-transparent p-0 py-0.5 ${hasContent ? "cursor-pointer" : "cursor-default"}`}
      >
        <ExpandableIcon
          icon={Brain}
          isLoading={isLoading}
          isExpandable={hasContent}
          isExpanded={isExpanded}
        />
        <Text className="text-[13px] text-gray-11">Thinking</Text>
      </button>
      {isExpanded && hasContent && (
        <Box className="mt-1 ml-5 max-w-4xl overflow-hidden rounded-lg border border-gray-6">
          <Box className="max-h-64 overflow-auto px-3 py-2">
            <Text asChild className="text-[13px] text-gray-11">
              <pre className="m-0 hyphens-auto whitespace-pre-wrap break-words font-mono">
                {displayedContent}
              </pre>
            </Text>
            {isCollapsible && !isExpanded && (
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="mt-1 flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-gray-10 hover:text-gray-12"
              >
                <Text className="text-[13px]">
                  +{hiddenLineCount} more lines
                </Text>
              </button>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
});
