import {
  ArrowsInSimple as ArrowsInSimpleIcon,
  ArrowsOutSimple as ArrowsOutSimpleIcon,
  Robot,
} from "@phosphor-icons/react";
import {
  LoadingIcon,
  StatusIndicators,
  type ToolViewProps,
  useToolCallStatus,
} from "@posthog/ui/features/sessions/components/session-update/toolCallUtils";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { useState } from "react";
import type { ConversationItem, TurnContext } from "../buildConversationItems";
import { SessionUpdateView } from "./SessionUpdateView";

interface SubagentToolViewProps extends ToolViewProps {
  childItems: ConversationItem[];
  turnContext: TurnContext;
}

export function SubagentToolView({
  toolCall,
  turnCancelled,
  turnComplete,
  childItems,
  turnContext,
}: SubagentToolViewProps) {
  const { title } = toolCall;
  const { isLoading, isFailed, wasCancelled } = useToolCallStatus(
    toolCall.status,
    turnCancelled,
    turnComplete,
  );

  const [isExpanded, setIsExpanded] = useState(false);

  const hasChildren = childItems.length > 0;

  return (
    <Box className="my-2 max-w-4xl overflow-hidden rounded-lg border border-gray-6 bg-gray-1">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-3 py-2"
      >
        <Flex align="center" gap="2">
          <LoadingIcon
            icon={Robot}
            isLoading={isLoading}
            className="text-gray-10"
          />
          <Text className="text-[13px] text-gray-10">
            {title || "Subagent"}
          </Text>
          <StatusIndicators isFailed={isFailed} wasCancelled={wasCancelled} />
        </Flex>
        {hasChildren && (
          <IconButton asChild size="1" variant="ghost" color="gray">
            <span>
              {isExpanded ? (
                <ArrowsInSimpleIcon size={12} />
              ) : (
                <ArrowsOutSimpleIcon size={12} />
              )}
            </span>
          </IconButton>
        )}
      </button>

      {isExpanded && hasChildren && (
        <Box className="space-y-1 border-gray-6 border-t px-2 py-2">
          {childItems.map((child) => {
            if (child.type !== "session_update") return null;
            return (
              <SessionUpdateView
                key={child.id}
                item={child.update}
                toolCalls={turnContext.toolCalls}
                childItems={turnContext.childItems}
                turnCancelled={turnContext.turnCancelled}
                turnComplete={turnContext.turnComplete}
              />
            );
          })}
        </Box>
      )}
    </Box>
  );
}
