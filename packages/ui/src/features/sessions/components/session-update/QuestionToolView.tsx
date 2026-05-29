import { ChatCircle, CheckCircle } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { ToolRow } from "./ToolRow";
import {
  getContentText,
  type ToolViewProps,
  useToolCallStatus,
} from "./toolCallUtils";

export function QuestionToolView({
  toolCall,
  turnCancelled,
  turnComplete,
}: ToolViewProps) {
  const { status, content, title } = toolCall;
  const { isLoading, isComplete, isFailed, wasCancelled } = useToolCallStatus(
    status,
    turnCancelled,
    turnComplete,
  );

  const answerText = getContentText(content);

  if (!isComplete || !answerText) {
    return (
      <ToolRow
        icon={ChatCircle}
        isLoading={isLoading}
        isFailed={isFailed}
        wasCancelled={wasCancelled}
      >
        {title || "Question"}
      </ToolRow>
    );
  }

  return (
    <Box className="my-2 max-w-4xl overflow-hidden rounded-lg border border-gray-6 bg-gray-1">
      <Flex align="center" gap="2" className="px-3 py-2">
        <ChatCircle size={12} className="text-gray-10" />
        <Text className="text-[13px] text-gray-10">{title || "Question"}</Text>
      </Flex>

      <Box className="border-gray-6 border-t px-3 py-2">
        <Flex align="center" gap="2">
          <CheckCircle size={14} weight="fill" className="text-green-9" />
          <Text className="text-[13px] text-green-11">{answerText}</Text>
        </Flex>
      </Box>
    </Box>
  );
}
