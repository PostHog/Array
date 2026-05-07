import { Tooltip } from "@components/ui/Tooltip";
import { useTaskDiffStats } from "@features/code-review/hooks/useTaskDiffStats";
import { useReviewNavigationStore } from "@features/code-review/stores/reviewNavigationStore";
import { GitDiff } from "@phosphor-icons/react";
import { Flex, Text } from "@radix-ui/themes";
import {
  formatHotkey,
  SHORTCUTS,
} from "@renderer/constants/keyboard-shortcuts";
import type { Task } from "@shared/types";

interface DiffStatsChipProps {
  task: Task;
}

export function DiffStatsChip({ task }: DiffStatsChipProps) {
  const taskId = task.id;
  const { filesChanged, linesAdded, linesRemoved } = useTaskDiffStats(task);

  const reviewMode = useReviewNavigationStore(
    (s) => s.reviewModes[taskId] ?? "closed",
  );
  const setReviewMode = useReviewNavigationStore((s) => s.setReviewMode);

  if (filesChanged === 0) return null;

  const isOpen = reviewMode !== "closed";

  const handleClick = () => {
    setReviewMode(taskId, isOpen ? "closed" : "expanded");
  };

  return (
    <Tooltip
      content={isOpen ? "Close review" : "Open review"}
      shortcut={formatHotkey(SHORTCUTS.TOGGLE_REVIEW_PANEL)}
      side="top"
    >
      <Flex
        align="center"
        gap="1"
        onClick={handleClick}
        className="cursor-pointer select-none text-[13px] text-gray-10 tabular-nums hover:text-gray-12"
      >
        <GitDiff size={12} className="shrink-0" />
        <Text className="text-[13px]">
          {filesChanged} {filesChanged === 1 ? "file" : "files"}
        </Text>
        {linesAdded > 0 && (
          <Text className="text-(--green-9) text-[13px]">+{linesAdded}</Text>
        )}
        {linesRemoved > 0 && (
          <Text className="text-(--red-9) text-[13px]">-{linesRemoved}</Text>
        )}
      </Flex>
    </Tooltip>
  );
}
