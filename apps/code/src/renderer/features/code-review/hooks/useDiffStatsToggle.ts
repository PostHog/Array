import { useReviewNavigationStore } from "@renderer/features/code-review/stores/reviewNavigationStore";
import type { Task } from "@shared/types";
import { useCallback } from "react";
import type { ReviewMode } from "../stores/reviewNavigationStore";
import { useTaskDiffSummaryStats } from "./useTaskDiffSummaryStats";

interface DiffStatsToggleResult {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  hasChanges: boolean;
  isOpen: boolean;
  toggle: () => void;
}

export function useDiffStatsToggle(
  task: Task,
  openMode: ReviewMode = "split",
): DiffStatsToggleResult {
  const taskId = task.id;
  const { filesChanged, linesAdded, linesRemoved } =
    useTaskDiffSummaryStats(task);

  const reviewMode = useReviewNavigationStore(
    (s) => s.reviewModes[taskId] ?? "closed",
  );
  const setReviewMode = useReviewNavigationStore((s) => s.setReviewMode);

  const isOpen = reviewMode !== "closed";
  const toggle = useCallback(
    () => setReviewMode(taskId, isOpen ? "closed" : openMode),
    [setReviewMode, taskId, isOpen, openMode],
  );

  return {
    filesChanged,
    linesAdded,
    linesRemoved,
    hasChanges: filesChanged > 0,
    isOpen,
    toggle,
  };
}
