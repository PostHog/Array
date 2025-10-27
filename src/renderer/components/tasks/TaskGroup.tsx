import { TaskListItems } from "@components/tasks/TaskListItems";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { Box, Code, Flex } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import type React from "react";

interface TaskGroupProps {
  name: string;
  tasks: Task[];
  isExpanded: boolean;
  onToggle: () => void;
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
  taskToGlobalIndex: Map<string, number>;
}

export function TaskGroup({
  name,
  tasks,
  isExpanded,
  onToggle,
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
}: TaskGroupProps) {
  return (
    <Collapsible.Root open={isExpanded} onOpenChange={onToggle}>
      <Collapsible.Trigger asChild>
        <Box
          p="2"
          style={{
            cursor: "pointer",
            borderBottom: "1px solid var(--gray-6)",
            borderRight: "1px solid var(--gray-6)",
          }}
          className="bg-gray-2 hover:bg-[var(--gray-4)]"
        >
          <Flex align="center" gap="2">
            {isExpanded ? (
              <CaretDownIcon size={14} />
            ) : (
              <CaretRightIcon size={14} />
            )}
            <Code
              size="1"
              weight="medium"
              variant="ghost"
              style={{ textTransform: "uppercase" }}
            >
              {name}
            </Code>
            <Code size="1" color="gray" variant="ghost">
              ({tasks.length})
            </Code>
          </Flex>
        </Box>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <TaskListItems
          tasks={tasks}
          draggedTaskId={draggedTaskId}
          dragOverIndex={dragOverIndex}
          dropPosition={dropPosition}
          selectedIndex={selectedIndex}
          hoveredIndex={hoveredIndex}
          contextMenuIndex={contextMenuIndex}
          onSelectTask={onSelectTask}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          onMoveTask={onMoveTask}
          taskToGlobalIndex={taskToGlobalIndex}
        />
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
