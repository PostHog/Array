import { Trash } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { FileMentionChip } from "./FileMentionChip";
import {
  type DiffContent,
  findDiffContent,
  LoadingIcon,
  StatusIndicators,
  type ToolViewProps,
  useToolCallStatus,
} from "./toolCallUtils";

function getDeletedLineCount(diff: DiffContent | undefined): number | null {
  if (!diff?.oldText) return null;
  return diff.oldText.split("\n").length;
}

export function DeleteToolView({
  toolCall,
  turnCancelled,
  turnComplete,
}: ToolViewProps) {
  const { status, locations, content } = toolCall;
  const { isLoading, isFailed, wasCancelled } = useToolCallStatus(
    status,
    turnCancelled,
    turnComplete,
  );

  const filePath = locations?.[0]?.path ?? "";
  const diff = findDiffContent(content);
  const deletedLines = getDeletedLineCount(diff);

  return (
    <Box className="max-w-4xl overflow-hidden rounded-lg border border-gray-6">
      <Flex align="center" gap="2" className="px-3 py-2">
        <LoadingIcon icon={Trash} isLoading={isLoading} />
        {filePath && <FileMentionChip filePath={filePath} />}
        {deletedLines !== null && (
          <Text className="font-mono text-[13px]">
            <span className="text-red-11">-{deletedLines}</span>
          </Text>
        )}
        <StatusIndicators isFailed={isFailed} wasCancelled={wasCancelled} />
      </Flex>
    </Box>
  );
}
