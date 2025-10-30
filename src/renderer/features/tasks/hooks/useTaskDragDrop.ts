import type { Task } from "@shared/types";
import type React from "react";
import { useCallback, useState } from "react";

export function useTaskDragDrop(
  filteredTasks: Task[],
  moveTask: (
    taskId: string,
    fromIndex: number,
    toIndex: number,
    allTasks: Task[],
  ) => void,
) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<"top" | "bottom" | null>(
    null,
  );

  const handleDragStart = useCallback((e: React.DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", taskId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const mouseY = e.clientY;

    setDragOverIndex(index);
    setDropPosition(mouseY < midpoint ? "top" : "bottom");
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
    setDropPosition(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      const sourceTaskId = e.dataTransfer.getData("text/plain");

      if (sourceTaskId) {
        const sourceIndex = filteredTasks.findIndex(
          (task) => task.id === sourceTaskId,
        );

        if (sourceIndex !== -1 && sourceIndex !== targetIndex) {
          let newTargetIndex = targetIndex;

          // Adjust target index based on drop position
          if (dropPosition === "bottom") {
            newTargetIndex = targetIndex + 1;
          }

          // If moving down, adjust for the source being removed
          if (sourceIndex < newTargetIndex) {
            newTargetIndex = newTargetIndex - 1;
          }

          const taskId = filteredTasks[sourceIndex].id;
          moveTask(taskId, sourceIndex, newTargetIndex, filteredTasks);
        }
      }

      setDraggedTaskId(null);
      setDragOverIndex(null);
      setDropPosition(null);
    },
    [filteredTasks, dropPosition, moveTask],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedTaskId(null);
    setDragOverIndex(null);
    setDropPosition(null);
  }, []);

  return {
    draggedTaskId,
    dragOverIndex,
    dropPosition,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  };
}
