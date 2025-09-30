import {
  Badge,
  Box,
  Button,
  Flex,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { formatDistanceToNow } from "date-fns";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useStatusBarStore } from "../stores/statusBarStore";
import { useTaskStore } from "../stores/taskStore";
import { AsciiArt } from "./AsciiArt";

interface TaskListProps {
  onSelectTask: (task: Task) => void;
}

export function TaskList({ onSelectTask }: TaskListProps) {
  const { tasks, fetchTasks, isLoading, error } = useTaskStore();
  const { setStatusBar, reset } = useStatusBarStore();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const filteredTasks = tasks
    .filter(
      (task) =>
        task.title.toLowerCase().includes(filter.toLowerCase()) ||
        task.description?.toLowerCase().includes(filter.toLowerCase()),
    )
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

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
      setSelectedIndex((prev) => {
        if (direction === "up") {
          return Math.max(0, prev - 1);
        } else {
          return Math.min(filteredTasks.length - 1, prev + 1);
        }
      });
    },
    [filteredTasks.length],
  );

  const handleSelectCurrent = useCallback(() => {
    if (filteredTasks[selectedIndex]) {
      onSelectTask(filteredTasks[selectedIndex]);
    }
  }, [filteredTasks, selectedIndex, onSelectTask]);

  // Keyboard shortcuts
  useHotkeys("up", () => handleKeyNavigation("up"), [handleKeyNavigation]);
  useHotkeys("down", () => handleKeyNavigation("down"), [handleKeyNavigation]);
  useHotkeys("enter", handleSelectCurrent, [handleSelectCurrent]);
  useHotkeys("cmd+r, ctrl+r", () => fetchTasks(), [fetchTasks]);

  // Scroll selected item into view
  useEffect(() => {
    const container = listRef.current;
    const selectedElement = container?.children[selectedIndex] as HTMLElement;

    if (selectedElement && container) {
      const containerRect = container.getBoundingClientRect();
      const elementRect = selectedElement.getBoundingClientRect();

      if (elementRect.bottom > containerRect.bottom) {
        selectedElement.scrollIntoView({ block: "end", behavior: "smooth" });
      } else if (elementRect.top < containerRect.top) {
        selectedElement.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }
  }, [selectedIndex]);

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
        <Box width="50%" p="4" className="border-gray-6 border-r">
          <Flex direction="column" height="100%">
            <Box py="4" className="border-gray-6 border-b">
              <TextField.Root
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setSelectedIndex(0);
                }}
                placeholder="Filter tasks..."
              />
            </Box>

            <Box ref={listRef} flexGrow="1" overflowY="auto">
              {filteredTasks.length === 0 ? (
                <Flex align="center" justify="center" height="100%">
                  <Text color="gray">
                    {filter ? "No tasks match your filter" : "No tasks found"}
                  </Text>
                </Flex>
              ) : (
                filteredTasks.map((task, index) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    isSelected={index === selectedIndex}
                    onClick={() => {
                      setSelectedIndex(index);
                      onSelectTask(task);
                    }}
                  />
                ))
              )}
            </Box>
          </Flex>
        </Box>

        <Box width="50%" height="100%">
          <AsciiArt scale={1} />
        </Box>
      </Flex>
    </Box>
  );
}

interface TaskItemProps {
  task: Task;
  isSelected: boolean;
  onClick: () => void;
}

function TaskItem({ task, isSelected, onClick }: TaskItemProps) {
  const createdAt = new Date(task.created_at);
  const timeAgo = formatDistanceToNow(createdAt, { addSuffix: true });

  // TODO: Look up stage name from workflow data
  const status = "Backlog";

  return (
    <Box
      p="2"
      className={`cursor-pointer border-gray-6 border-b font-mono ${
        isSelected ? "bg-gray-3" : ""
      }`}
      onClick={onClick}
    >
      <Flex align="center" gap="2">
        <Text color="gray" size="1">
          {isSelected ? "[•]" : "[ ]"}
        </Text>

        <Badge color={status === "Backlog" ? "gray" : undefined} size="1">
          {status}
        </Badge>

        <Text
          size="2"
          className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
        >
          {task.title}
        </Text>

        {task.repository_config &&
        typeof task.repository_config === "object" &&
        "organization" in task.repository_config &&
        "repository" in task.repository_config ? (
          <Text size="1" color="gray">
            {String(task.repository_config.organization)}/
            {String(task.repository_config.repository)}
          </Text>
        ) : null}

        <Text size="1" color="gray" className="whitespace-nowrap">
          {timeAgo}
        </Text>
      </Flex>
    </Box>
  );
}
