import { TaskGroup } from "@components/tasks/TaskGroup";
import { TaskListItems } from "@components/tasks/TaskListItems";
import { Flex, Text } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import type { GroupByField } from "@stores/taskStore";
import type React from "react";

interface TaskListContentProps {
  filteredTasks: Task[];
  groupedTasks: {
    groups: Array<{ name: string; tasks: Task[] }>;
    taskToGlobalIndex: Map<string, number>;
  } | null;
  groupBy: GroupByField;
  expandedGroups: Record<string, boolean>;
  toggleGroupExpanded: (groupName: string) => void;
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
  filter: string;
}

export function TaskListContent({
  filteredTasks,
  groupedTasks,
  expandedGroups,
  toggleGroupExpanded,
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
  filter,
}: TaskListContentProps) {
  if (filteredTasks.length === 0) {
    return (
      <Flex align="center" justify="center" height="100%">
        <Text color="gray">
          {filter ? "No tasks match your filter" : "No tasks found"}
        </Text>
      </Flex>
    );
  }

  if (groupedTasks) {
    return (
      <>
        {groupedTasks.groups.map((group) => {
          const isExpanded = expandedGroups[group.name] ?? true;
          return (
            <TaskGroup
              key={group.name}
              name={group.name}
              tasks={group.tasks}
              isExpanded={isExpanded}
              onToggle={() => toggleGroupExpanded(group.name)}
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
              taskToGlobalIndex={groupedTasks.taskToGlobalIndex}
            />
          );
        })}
      </>
    );
  }

  return (
    <TaskListItems
      tasks={filteredTasks}
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
    />
  );
}
