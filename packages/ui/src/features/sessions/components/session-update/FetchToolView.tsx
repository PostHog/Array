import { Globe } from "@phosphor-icons/react";
import { Box, Flex, Link } from "@radix-ui/themes";
import { useState } from "react";
import {
  ContentPre,
  ExpandableIcon,
  findResourceLink,
  getContentText,
  StatusIndicators,
  ToolTitle,
  type ToolViewProps,
  truncateText,
  useToolCallStatus,
} from "./toolCallUtils";

const MAX_URL_LENGTH = 60;

export function FetchToolView({
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

  const resourceLink = findResourceLink(content);
  const fetchedContent = getContentText(content) ?? "";
  const hasContent = fetchedContent.trim().length > 0;

  const url = resourceLink?.uri ?? "";
  const isExpandable = hasContent || url.length > MAX_URL_LENGTH;

  const handleClick = () => {
    if (isExpandable) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <Box>
      <Flex
        align="center"
        gap="2"
        className={`group min-w-0 py-0.5 ${isExpandable ? "cursor-pointer" : ""}`}
        onClick={handleClick}
      >
        <ExpandableIcon
          icon={Globe}
          isLoading={isLoading}
          isExpandable={isExpandable}
          isExpanded={isExpanded}
        />
        <ToolTitle>{title || "Fetch"}</ToolTitle>
        {url && (
          <ToolTitle>
            <span className="font-mono text-accent-11">
              {truncateText(url, MAX_URL_LENGTH)}
            </span>
          </ToolTitle>
        )}
        <StatusIndicators isFailed={isFailed} wasCancelled={wasCancelled} />
      </Flex>

      {isExpanded && (
        <Box className="max-w-4xl overflow-hidden rounded-lg border border-gray-6">
          {url.length > MAX_URL_LENGTH && (
            <Box
              className={
                hasContent ? "border-gray-6 border-b px-3 py-2" : "px-3 py-2"
              }
            >
              <Link
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-[13px]"
                onClick={(e) => e.stopPropagation()}
              >
                {url}
              </Link>
            </Box>
          )}
          {hasContent && <ContentPre>{fetchedContent}</ContentPre>}
        </Box>
      )}
    </Box>
  );
}
