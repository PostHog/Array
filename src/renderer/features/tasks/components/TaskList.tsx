import { ResizeHandle } from "@components/ui/ResizeHandle";
import { useAuthStore } from "@features/auth/stores/authStore";
import { CliTaskPanel } from "@features/tasks/components/CliTaskPanel";
import { TaskListContent } from "@features/tasks/components/TaskListContent";
import { TaskListHeader } from "@features/tasks/components/TaskListHeader";
import { useCliPanelResize } from "@features/tasks/hooks/useCliPanelResize";
import { useTaskDragDrop } from "@features/tasks/hooks/useTaskDragDrop";
import { useTaskGrouping } from "@features/tasks/hooks/useTaskGrouping";
import { useTaskKeyboardNavigation } from "@features/tasks/hooks/useTaskKeyboardNavigation";
import { useTaskScrolling } from "@features/tasks/hooks/useTaskScrolling";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { filterTasks, useTaskStore } from "@features/tasks/stores/taskStore";
import { useStatusBar } from "@hooks/useStatusBar";
import { useUsers } from "@hooks/useUsers";
import { Box, Button, Flex, Spinner, Text } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useLayoutStore } from "@stores/layoutStore";
import { useCallback, useRef } from "react";

interface TaskListProps {
  onSelectTask: (task: Task) => void;
}

export function TaskList({ onSelectTask }: TaskListProps) {
  // Data fetching
  const { data: tasks = [], isLoading, error, refetch } = useTasks();
  const { data: users = [] } = useUsers();

  // Store state
  const filter = useTaskStore((state) => state.filter);
  const selectedIndex = useTaskStore((state) => state.selectedIndex);
  const hoveredIndex = useTaskStore((state) => state.hoveredIndex);
  const contextMenuIndex = useTaskStore((state) => state.contextMenuIndex);
  const orderBy = useTaskStore((state) => state.orderBy);
  const orderDirection = useTaskStore((state) => state.orderDirection);
  const groupBy = useTaskStore((state) => state.groupBy);
  const expandedGroups = useTaskStore((state) => state.expandedGroups);

  // Store actions
  const moveTask = useTaskStore((state) => state.moveTask);
  const setSelectedIndex = useTaskStore((state) => state.setSelectedIndex);
  const setHoveredIndex = useTaskStore((state) => state.setHoveredIndex);
  const setFilter = useTaskStore((state) => state.setFilter);
  const toggleGroupExpanded = useTaskStore(
    (state) => state.toggleGroupExpanded,
  );

  const { logout } = useAuthStore();
  const cliPanelWidth = useLayoutStore((state) => state.cliPanelWidth);
  const setCliPanelWidth = useLayoutStore((state) => state.setCliPanelWidth);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredTasks = filterTasks(tasks, orderBy, orderDirection, filter);
  const groupedTasks = useTaskGrouping(filteredTasks, groupBy, users);
  const { isResizing, handleMouseDown } = useCliPanelResize(setCliPanelWidth);

  const handleMoveTask = useCallback(
    (fromIndex: number, toIndex: number) => {
      const taskId = filteredTasks[fromIndex].id;
      moveTask(taskId, fromIndex, toIndex, filteredTasks);
    },
    [filteredTasks, moveTask],
  );

  const {
    draggedTaskId,
    dragOverIndex,
    dropPosition,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  } = useTaskDragDrop(filteredTasks, moveTask);

  useTaskKeyboardNavigation(
    filteredTasks,
    selectedIndex,
    hoveredIndex,
    contextMenuIndex,
    setSelectedIndex,
    setHoveredIndex,
    onSelectTask,
    refetch,
  );

  useTaskScrolling(listRef, selectedIndex, filteredTasks.length);

  // Status bar
  useStatusBar(
    `${filteredTasks.length} task${filteredTasks.length === 1 ? "" : "s"}`,
    [
      {
        keys: [navigator.platform.includes("Mac") ? "⌘" : "Ctrl", "K"],
        description: "Command",
      },
      {
        keys: [navigator.platform.includes("Mac") ? "⌘" : "Ctrl", "R"],
        description: "Refresh",
      },
      {
        keys: ["↑", "↓"],
        description: "Navigate",
      },
      {
        keys: ["Enter"],
        description: "Select",
      },
    ],
    "replace",
  );

  // Loading state
  if (isLoading && tasks.length === 0) {
    return (
      <Box height="100%" p="6">
        <Flex align="center" justify="center" height="100%">
          <Flex align="center" gap="3">
            <Spinner size="3" />
            <Text color="gray">Loading tasks...</Text>
          </Flex>
        </Flex>
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box height="100%" p="6">
        <Flex
          direction="column"
          align="center"
          justify="center"
          height="100%"
          gap="4"
        >
          <Text color="red">
            {error instanceof Error ? error.message : "Failed to load tasks"}
          </Text>
          <Flex gap="2">
            <Button onClick={() => refetch()}>Retry</Button>
            <Button variant="outline" onClick={logout}>
              Logout
            </Button>
          </Flex>
        </Flex>
      </Box>
    );
  }

  return (
    <Flex height="100%" style={{ position: "relative" }}>
      {/* Left side: Task list */}
      <Flex
        direction="column"
        style={{ width: `calc(${100 - cliPanelWidth}% - 14px)` }}
      >
        <TaskListHeader
          filter={filter}
          onFilterChange={(newFilter) => {
            setFilter(newFilter);
            setSelectedIndex(null);
          }}
        />

        <Box ref={listRef} flexGrow="1" overflowY="auto">
          <TaskListContent
            filteredTasks={filteredTasks}
            groupedTasks={groupedTasks}
            groupBy={groupBy}
            expandedGroups={expandedGroups}
            toggleGroupExpanded={toggleGroupExpanded}
            draggedTaskId={draggedTaskId}
            dragOverIndex={dragOverIndex}
            dropPosition={dropPosition}
            selectedIndex={selectedIndex}
            hoveredIndex={hoveredIndex}
            contextMenuIndex={contextMenuIndex}
            onSelectTask={onSelectTask}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onMoveTask={handleMoveTask}
            filter={filter}
          />
        </Box>
      </Flex>

      <ResizeHandle isResizing={isResizing} onMouseDown={handleMouseDown} />

      {/* Right side: CLI panel */}
      <Box style={{ width: `calc(${cliPanelWidth}% - 14px)` }}>
        <CliTaskPanel />
      </Box>
    </Flex>
  );
}
