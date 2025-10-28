import { TaskItem } from "@features/tasks/components/TaskItem";
import type { Task } from "@shared/types";
import type React from "react";

interface TaskListItemsProps {
  tasks: Task[];
  draggedTaskId: string | null;
  dragOverIndex: number | null;
  dropPosition: "top" | "bottom" | null;
  selectedIndex: number | null;
  hoveredIndex: number | null;
  contextMenuIndex: number | null;
  onSelectTask: (task: Task) => void;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onMoveTask: (fromIndex: number, toIndex: number) => void;
  taskToGlobalIndex?: Map<string, number>;
}

export function TaskListItems({
  tasks,
  draggedTaskId,
  dragOverIndex,
  dropPosition,
  selectedIndex,
  hoveredIndex,
  contextMenuIndex,
  onSelectTask,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMoveTask,
  taskToGlobalIndex,
}: TaskListItemsProps) {
  return (
    <>
      {tasks.map((task, localIndex) => {
        const globalIndex = taskToGlobalIndex?.get(task.id) ?? localIndex;
        const isDragging = draggedTaskId === task.id;
        const isDragOver = dragOverIndex === globalIndex;
        const showTopIndicator = isDragOver && dropPosition === "top";
        const showBottomIndicator = isDragOver && dropPosition === "bottom";

        return (
          <TaskItem
            key={task.id}
            task={task}
            index={globalIndex}
            isHighlighted={
              globalIndex === selectedIndex ||
              globalIndex === hoveredIndex ||
              globalIndex === contextMenuIndex
            }
            isDragging={isDragging}
            showTopIndicator={showTopIndicator}
            showBottomIndicator={showBottomIndicator}
            onSelectTask={onSelectTask}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            onMoveTask={onMoveTask}
            filteredTasksLength={tasks.length}
          />
        );
      })}
    </>
  );
}
