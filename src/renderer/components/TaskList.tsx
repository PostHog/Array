import { FileTextIcon, PlusIcon } from "@radix-ui/react-icons";
import {
  Box,
  Button,
  Flex,
  IconButton,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import type { Task } from "@shared/types";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useStatusBarStore } from "../stores/statusBarStore";
import { useTaskStore } from "../stores/taskStore";
import { AsciiArt } from "./AsciiArt";
import { ShortcutCard } from "./ShortcutCard";
import { TaskItem } from "./TaskItem";

interface TaskListProps {
  onSelectTask: (task: Task) => void;
}

interface TaskListInternalProps extends TaskListProps {
  onNewTask?: () => void;
}

export function TaskList({ onSelectTask, onNewTask }: TaskListInternalProps) {
  const tasks = useTaskStore((state) => state.tasks);
  const taskOrder = useTaskStore((state) => state.taskOrder);
  const filter = useTaskStore((state) => state.filter);
  const isLoading = useTaskStore((state) => state.isLoading);
  const error = useTaskStore((state) => state.error);
  const selectedIndex = useTaskStore((state) => state.selectedIndex);
  const hoveredIndex = useTaskStore((state) => state.hoveredIndex);
  const contextMenuIndex = useTaskStore((state) => state.contextMenuIndex);

  // Move drag state to local state for better performance
  const [draggedTaskId, setDraggedTaskIdLocal] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndexLocal] = useState<number | null>(null);
  const [dropPosition, setDropPositionLocal] = useState<"top" | "bottom" | null>(null);

  const fetchTasks = useTaskStore((state) => state.fetchTasks);
  const deleteTask = useTaskStore((state) => state.deleteTask);
  const duplicateTask = useTaskStore((state) => state.duplicateTask);
  const moveTask = useTaskStore((state) => state.moveTask);
  const setSelectedIndex = useTaskStore((state) => state.setSelectedIndex);
  const setHoveredIndex = useTaskStore((state) => state.setHoveredIndex);
  const setContextMenuIndex = useTaskStore(
    (state) => state.setContextMenuIndex,
  );
  const setFilter = useTaskStore((state) => state.setFilter);

  const { setStatusBar, reset } = useStatusBarStore();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const filteredTasks = useMemo(() => {
    // Sort tasks by custom order or creation date
    const orderedTasks = [...tasks].sort((a, b) => {
      const orderA = taskOrder[a.id] ?? Number.MAX_SAFE_INTEGER;
      const orderB = taskOrder[b.id] ?? Number.MAX_SAFE_INTEGER;

      if (
        orderA === Number.MAX_SAFE_INTEGER &&
        orderB === Number.MAX_SAFE_INTEGER
      ) {
        // Both tasks have no custom order, sort by creation date
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      }

      return orderA - orderB;
    });

    // Filter tasks
    return orderedTasks.filter(
      (task) =>
        task.title.toLowerCase().includes(filter.toLowerCase()) ||
        task.description?.toLowerCase().includes(filter.toLowerCase()),
    );
  }, [tasks, taskOrder, filter]);

  const handleMoveTask = useCallback(
    (fromIndex: number, toIndex: number) => {
      const taskId = filteredTasks[fromIndex].id;
      moveTask(taskId, fromIndex, toIndex, filteredTasks);
    },
    [filteredTasks, moveTask],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, taskId: string) => {
      setDraggedTaskIdLocal(taskId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", taskId);
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const rect = e.currentTarget.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const mouseY = e.clientY;

      setDragOverIndexLocal(index);
      setDropPositionLocal(mouseY < midpoint ? "top" : "bottom");
    },
    [],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverIndexLocal(null);
    setDropPositionLocal(null);
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

          handleMoveTask(sourceIndex, newTargetIndex);
        }
      }

      setDraggedTaskIdLocal(null);
      setDragOverIndexLocal(null);
      setDropPositionLocal(null);
    },
    [filteredTasks, dropPosition, handleMoveTask],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedTaskIdLocal(null);
    setDragOverIndexLocal(null);
    setDropPositionLocal(null);
  }, []);


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

    return () => {
      reset();
    };
  }, [setStatusBar, reset, filteredTasks.length]);

  const handleKeyNavigation = useCallback(
    (direction: "up" | "down") => {
      setHoveredIndex(null);
      const startIndex = selectedIndex ?? hoveredIndex ?? 0;
      if (direction === "up") {
        setSelectedIndex(Math.max(0, startIndex - 1));
      } else {
        setSelectedIndex(Math.min(filteredTasks.length - 1, startIndex + 1));
      }
    },
    [
      filteredTasks.length,
      hoveredIndex,
      selectedIndex,
      setHoveredIndex,
      setSelectedIndex,
    ],
  );

  const handleSelectCurrent = useCallback(() => {
    const index = selectedIndex ?? hoveredIndex;
    if (index !== null && filteredTasks[index]) {
      onSelectTask(filteredTasks[index]);
    }
  }, [filteredTasks, selectedIndex, hoveredIndex, onSelectTask]);

  useHotkeys(
    "up",
    () => handleKeyNavigation("up"),
    { enableOnFormTags: false, enabled: contextMenuIndex === null },
    [handleKeyNavigation, contextMenuIndex],
  );
  useHotkeys(
    "down",
    () => handleKeyNavigation("down"),
    { enableOnFormTags: false, enabled: contextMenuIndex === null },
    [handleKeyNavigation, contextMenuIndex],
  );
  useHotkeys(
    "enter",
    handleSelectCurrent,
    { enableOnFormTags: false, enabled: contextMenuIndex === null },
    [handleSelectCurrent, contextMenuIndex],
  );
  useHotkeys("cmd+r, ctrl+r", () => fetchTasks(), [fetchTasks]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex === null || filteredTasks.length === 0) return;
    const container = listRef.current;
    if (!container) return;

    // Get only actual task items (not drag preview elements)
    const taskItems = Array.from(
      container.querySelectorAll('[data-task-item="true"]'),
    ) as HTMLElement[];
    const selectedElement = taskItems[selectedIndex];

    if (selectedElement) {
      const containerRect = container.getBoundingClientRect();
      const elementRect = selectedElement.getBoundingClientRect();

      // Check if element is not fully visible
      if (elementRect.bottom > containerRect.bottom) {
        // Scrolling down - align to bottom
        const scrollAmount = elementRect.bottom - containerRect.bottom;
        container.scrollTop += scrollAmount;
      } else if (elementRect.top < containerRect.top) {
        // Scrolling up - align to top
        const scrollAmount = containerRect.top - elementRect.top;
        container.scrollTop -= scrollAmount;
      }
    }
  }, [selectedIndex, filteredTasks.length]);

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

  if (error) {
    return (
      <Box height="100%" p="6">
        <Flex direction="column" align="center" justify="center" height="100%">
          <Text color="red">{error}</Text>
          <Button onClick={() => fetchTasks()}>Retry</Button>
        </Flex>
      </Box>
    );
  }

  return (
    <Box height="100%">
      <Flex height="100%">
        {/* Left pane - Task list */}
        <Box width="50%" p="4" pt="0" className="border-gray-6 border-r">
          <Flex direction="column" height="100%">
            <Box py="4" className="border-gray-6 border-b">
              <Flex gap="2">
                <TextField.Root
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setSelectedIndex(null);
                  }}
                  placeholder="Filter tasks..."
                  style={{ flexGrow: 1 }}
                />
                <IconButton
                  size="2"
                  variant="classic"
                  onClick={onNewTask}
                  title="New task (⌘N)"
                >
                  <PlusIcon />
                </IconButton>
              </Flex>
            </Box>

            <Box ref={listRef} flexGrow="1" overflowY="auto">
              {filteredTasks.length === 0 ? (
                <Flex align="center" justify="center" height="100%">
                  <Text color="gray">
                    {filter ? "No tasks match your filter" : "No tasks found"}
                  </Text>
                </Flex>
              ) : (
                filteredTasks.map((task, index) => {
                  const isDragging = draggedTaskId === task.id;
                  const isDragOver = dragOverIndex === index;
                  const showTopIndicator = isDragOver && dropPosition === "top";
                  const showBottomIndicator =
                    isDragOver && dropPosition === "bottom";

                  return (
                    <TaskItem
                      key={task.id}
                      task={task}
                      index={index}
                      isHighlighted={
                        index === selectedIndex ||
                        index === hoveredIndex ||
                        index === contextMenuIndex
                      }
                      isDragging={isDragging}
                      showTopIndicator={showTopIndicator}
                      showBottomIndicator={showBottomIndicator}
                      onSelectTask={onSelectTask}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onDragEnd={handleDragEnd}
                      onMoveTask={handleMoveTask}
                      filteredTasksLength={filteredTasks.length}
                    />
                  );
                })
              )}
            </Box>
          </Flex>
        </Box>

        <Box
          width="50%"
          height="100%"
          className="bg-panel-solid"
          style={{ position: "relative" }}
        >
          {/* Background ASCII Art */}
          <Box style={{ position: "absolute", inset: 0, zIndex: 0 }}>
            <AsciiArt scale={1} opacity={0.1} />
          </Box>
          {/* Foreground Cards */}
          <Box
            style={{
              position: "relative",
              zIndex: 1,
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Flex direction="column" gap="4" p="6">
              <Box onClick={onNewTask}>
                <ShortcutCard
                  icon={<FileTextIcon className="h-4 w-4 text-gray-11" />}
                  title="New task"
                  keys={[
                    navigator.platform.includes("Mac") ? "⌘" : "Ctrl",
                    "N",
                  ]}
                />
              </Box>
            </Flex>
          </Box>
        </Box>
      </Flex>
    </Box>
  );
}
