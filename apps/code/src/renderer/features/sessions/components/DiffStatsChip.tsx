import { Tooltip } from "@components/ui/Tooltip";
import { useDiffStatsToggle } from "@features/code-review/hooks/useDiffStatsToggle";
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
  const { filesChanged, linesAdded, linesRemoved, isOpen, toggle } =
    useDiffStatsToggle(task, "expanded");

  if (filesChanged === 0) return null;

  return (
    <Tooltip
      content={isOpen ? "Close review" : "Open review"}
      shortcut={formatHotkey(SHORTCUTS.TOGGLE_REVIEW_PANEL)}
      side="top"
    >
      <Flex
        align="center"
        gap="1"
        onClick={toggle}
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
