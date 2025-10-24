import { Box, Button, Flex, Spinner, Text } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useCallback, useEffect, useRef } from "react";
import { useTasks } from "../../hooks/useTasks";
import { useUsers } from "../../hooks/useUsers";
import { useAuthStore } from "../../stores/authStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useStatusBarStore } from "../../stores/statusBarStore";
import { useTaskStore } from "../../stores/taskStore";
import { CliTaskPanel } from "./CliTaskPanel";
import { useCliPanelResize } from "./hooks/useCliPanelResize";
import { useTaskDragDrop } from "./hooks/useTaskDragDrop";
import { useTaskFiltering } from "./hooks/useTaskFiltering";
import { useTaskGrouping } from "./hooks/useTaskGrouping";
import { useTaskKeyboardNavigation } from "./hooks/useTaskKeyboardNavigation";
import { useTaskScrolling } from "./hooks/useTaskScrolling";
import { TaskListContent } from "./TaskListContent";
import { TaskListHeader } from "./TaskListHeader";

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

  const { setStatusBar, reset } = useStatusBarStore();
  const { logout } = useAuthStore();
  const cliPanelWidth = useLayoutStore((state) => state.cliPanelWidth);
  const setCliPanelWidth = useLayoutStore((state) => state.setCliPanelWidth);
  const listRef = useRef<HTMLDivElement>(null);

  // Custom hooks
  const filteredTasks = useTaskFiltering(
    tasks,
    orderBy,
    orderDirection,
    filter,
  );
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
  useEffect(() => {
    setStatusBar({
      statusText: `${filteredTasks.length} task${filteredTasks.length === 1 ? "" : "s"}`,
      keyHints: [
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
      mode: "replace",
    });

    return () => reset();
  }, [setStatusBar, reset, filteredTasks.length]);

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
    <Flex height="100%">
      {/* Left side: Task list */}
      <Flex direction="column" style={{ width: `${100 - cliPanelWidth}%` }}>
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

      {/* Resize handle - outer div for hitbox */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: This is a drag handle for resizing */}
      <div
        style={{
          width: "12px",
          cursor: "col-resize",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginLeft: "8px",
          marginRight: "8px",
        }}
        onMouseDown={handleMouseDown}
        onMouseEnter={(e) => {
          if (!isResizing) {
            const bar = e.currentTarget.querySelector(
              ".drag-bar",
            ) as HTMLElement;
            if (bar) bar.style.backgroundColor = "var(--gray-a8)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isResizing) {
            const bar = e.currentTarget.querySelector(
              ".drag-bar",
            ) as HTMLElement;
            if (bar) bar.style.backgroundColor = "var(--gray-a4)";
          }
        }}
      >
        {/* Inner div for 2px drag bar */}
        <div
          className="drag-bar"
          style={{
            width: "1px",
            height: "100%",
            backgroundColor: isResizing ? "var(--accent-9)" : "var(--gray-a4)",
            transition: "background-color 0.2s",
          }}
        />
      </div>

      {/* Right side: CLI panel */}
      <Box style={{ width: `${cliPanelWidth}%` }}>
        <CliTaskPanel />
      </Box>
    </Flex>
  );
}
