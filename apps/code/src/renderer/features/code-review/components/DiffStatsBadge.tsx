import { Tooltip } from "@components/ui/Tooltip";
import { GitDiff } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Flex, Text } from "@radix-ui/themes";
import {
  formatHotkey,
  SHORTCUTS,
} from "@renderer/constants/keyboard-shortcuts";
import type { Task } from "@shared/types";
import { useDiffStatsToggle } from "../hooks/useDiffStatsToggle";

interface DiffStatsBadgeProps {
  task: Task;
}

export function DiffStatsBadge({ task }: DiffStatsBadgeProps) {
  const { linesAdded, linesRemoved, hasChanges, isOpen, toggle } =
    useDiffStatsToggle(task, "split");

  return (
    <Tooltip
      content={isOpen ? "Close review panel" : "Open review panel"}
      shortcut={formatHotkey(SHORTCUTS.TOGGLE_REVIEW_PANEL)}
      side="bottom"
    >
      <Button
        onClick={toggle}
        variant="outline"
        size="sm"
        className={`no-drag font-mono text-(--gray-11) text-[11px] transition-colors duration-100 hover:bg-(--gray-a3) ${isOpen ? "bg-(--gray-a3)" : "bg-transparent"}`}
      >
        <GitDiff size={14} className="shrink-0" />
        {hasChanges ? (
          <Flex align="center" gap="1">
            {linesAdded > 0 && (
              <Text className="text-(--green-9) text-[11px]">
                +{linesAdded}
              </Text>
            )}
            {linesRemoved > 0 && (
              <Text className="text-(--red-9) text-[11px]">
                -{linesRemoved}
              </Text>
            )}
          </Flex>
        ) : (
          <Text className="text-(--gray-9) text-[11px]">0</Text>
        )}
      </Button>
    </Tooltip>
  );
}
