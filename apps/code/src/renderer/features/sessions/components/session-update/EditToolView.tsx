import {
  ArrowsInSimple as ArrowsInSimpleIcon,
  ArrowsOutSimple as ArrowsOutSimpleIcon,
  PencilSimple,
} from "@phosphor-icons/react";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { CodePreview } from "./CodePreview";
import { FileMentionChip } from "./FileMentionChip";
import {
  findDiffContent,
  LoadingIcon,
  StatusIndicators,
  type ToolViewProps,
  useToolCallStatus,
} from "./toolCallUtils";

function getDiffStats(
  oldText: string | null | undefined,
  newText: string | null | undefined,
): { added: number; removed: number } {
  const oldLines = oldText ? oldText.split("\n") : [];
  const newLines = newText ? newText.split("\n") : [];

  if (!oldText) {
    return { added: newLines.length, removed: 0 };
  }

  const oldCounts = new Map<string, number>();
  for (const line of oldLines) {
    oldCounts.set(line, (oldCounts.get(line) ?? 0) + 1);
  }

  const newCounts = new Map<string, number>();
  for (const line of newLines) {
    newCounts.set(line, (newCounts.get(line) ?? 0) + 1);
  }

  let added = 0;
  let removed = 0;

  for (const [line, count] of newCounts) {
    const oldCount = oldCounts.get(line) ?? 0;
    if (count > oldCount) added += count - oldCount;
  }

  for (const [line, count] of oldCounts) {
    const newCount = newCounts.get(line) ?? 0;
    if (count > newCount) removed += count - newCount;
  }

  return { added, removed };
}

export function EditToolView({
  toolCall,
  turnCancelled,
  turnComplete,
}: ToolViewProps) {
  const { status, content, locations } = toolCall;
  const { isLoading, isFailed, wasCancelled } = useToolCallStatus(
    status,
    turnCancelled,
    turnComplete,
  );

  const diff = findDiffContent(content);
  const filePath = diff?.path ?? locations?.[0]?.path ?? "";
  const oldText = diff?.oldText;
  const newText = diff?.newText;
  const isNewFile = diff && !oldText;
  const hasDiff = diff && (oldText || newText);
  const diffStats = diff ? getDiffStats(oldText, newText) : null;

  const isPlanFile = filePath.includes("claude/plans/");
  const [isExpanded, setIsExpanded] = useState(!isPlanFile);

  useEffect(() => {
    if (isPlanFile) {
      setIsExpanded(false);
    }
  }, [isPlanFile]);

  return (
    <Box className="max-w-4xl overflow-hidden rounded-lg border border-gray-6">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-3 py-2"
      >
        <Flex align="center" gap="2">
          <LoadingIcon icon={PencilSimple} isLoading={isLoading} />
          {filePath && <FileMentionChip filePath={filePath} />}
          {diffStats && (
            <Text className="font-mono text-[13px]">
              <span className="text-green-11">+{diffStats.added}</span>{" "}
              <span className="text-red-11">-{diffStats.removed}</span>
            </Text>
          )}
          <StatusIndicators isFailed={isFailed} wasCancelled={wasCancelled} />
        </Flex>
        {hasDiff && (
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

      {isExpanded && hasDiff && (
        <CodePreview
          content={newText ?? ""}
          filePath={filePath}
          oldContent={isNewFile ? null : oldText}
          maxHeight="700px"
          cacheKey={toolCall.toolCallId}
        />
      )}
    </Box>
  );
}
