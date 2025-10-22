import { GitPullRequest } from "@phosphor-icons/react";
import { CopyIcon, TrashIcon } from "@radix-ui/react-icons";
import { Badge, Box, Code, ContextMenu, Flex, Text } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { differenceInHours, format, formatDistanceToNow } from "date-fns";
import type React from "react";
import { memo, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useDeleteTask, useDuplicateTask } from "../../hooks/useTasks";
import { useTaskStore } from "../../stores/taskStore";
import { TaskDragPreview } from "./TaskDragPreview";

interface TaskItemProps {
  task: Task;
  index: number;
  isHighlighted: boolean;
  isDragging: boolean;
  showTopIndicator: boolean;
  showBottomIndicator: boolean;
  onSelectTask: (task: Task) => void;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onMoveTask: (fromIndex: number, toIndex: number) => void;
  filteredTasksLength: number;
}

function TaskItemComponent({
  task,
  index,
  isHighlighted,
  isDragging,
  showTopIndicator,
  showBottomIndicator,
  onSelectTask,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMoveTask,
  filteredTasksLength,
}: TaskItemProps) {
  // Get store actions
  const { mutate: deleteTask } = useDeleteTask();
  const { mutate: duplicateTask } = useDuplicateTask();
  const setSelectedIndex = useTaskStore((state) => state.setSelectedIndex);
  const setHoveredIndex = useTaskStore((state) => state.setHoveredIndex);
  const setContextMenuIndex = useTaskStore(
    (state) => state.setContextMenuIndex,
  );
  const selectedIndex = useTaskStore((state) => state.selectedIndex);
  const contextMenuIndex = useTaskStore((state) => state.contextMenuIndex);
  const createdAt = new Date(task.created_at);
  const hoursSinceCreated = differenceInHours(new Date(), createdAt);
  const timeDisplay =
    hoursSinceCreated < 24
      ? formatDistanceToNow(createdAt, { addSuffix: true })
      : format(createdAt, "MMM d");
  const dragPreviewRef = useRef<HTMLDivElement>(null);

  // Determine status: If PR exists, mark as completed, otherwise use latest_run status
  const prUrl = task.latest_run?.output?.pr_url as string | undefined;
  const hasPR = !!prUrl;
  const status = hasPR ? "completed" : task.latest_run?.status || "Backlog";

  const handleOpenPR = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (prUrl) {
      window.electronAPI.openExternal(prUrl);
    }
  };

  const statusColorMap: Record<
    string,
    "green" | "red" | "blue" | "amber" | "gray"
  > = {
    completed: "green",
    failed: "red",
    in_progress: "blue",
    started: "amber",
    Backlog: "gray",
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (dragPreviewRef.current) {
      e.dataTransfer.setDragImage(dragPreviewRef.current, 0, 0);
    }
    onDragStart(e, task.id);
  };

  const handleDelete = () => {
    deleteTask(task.id);
  };

  const handleDuplicate = () => {
    duplicateTask(task.id);
  };

  useHotkeys(
    "mod+d",
    (e) => {
      e.preventDefault();
      handleDuplicate();
    },
    { enabled: isHighlighted },
  );

  useHotkeys(
    "mod+backspace",
    (e) => {
      e.preventDefault();
      handleDelete();
    },
    { enabled: isHighlighted },
  );

  useHotkeys(
    "alt+shift+up",
    (e) => {
      e.preventDefault();
      onMoveTask(index, 0);
    },
    { enabled: isHighlighted },
  );

  useHotkeys(
    "alt+up",
    (e) => {
      e.preventDefault();
      onMoveTask(index, Math.max(0, index - 1));
    },
    { enabled: isHighlighted },
  );

  useHotkeys(
    "alt+down",
    (e) => {
      e.preventDefault();
      onMoveTask(index, Math.min(filteredTasksLength - 1, index + 1));
    },
    { enabled: isHighlighted },
  );

  useHotkeys(
    "alt+shift+down",
    (e) => {
      e.preventDefault();
      onMoveTask(index, filteredTasksLength - 1);
    },
    { enabled: isHighlighted },
  );

  return (
    <>
      <TaskDragPreview
        ref={dragPreviewRef}
        status={status}
        title={task.title}
      />

      <ContextMenu.Root
        onOpenChange={(open) => {
          if (open) {
            setContextMenuIndex(index);
          } else {
            setContextMenuIndex(null);
          }
        }}
      >
        <ContextMenu.Trigger>
          <Box
            p="2"
            className={`relative cursor-pointer border-gray-6 border-b font-mono ${
              isHighlighted ? "bg-gray-3" : ""
            } ${isDragging ? "opacity-50" : ""}`}
            data-task-item="true"
            onClick={() => {
              setSelectedIndex(index);
              onSelectTask(task);
            }}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => {
              if (contextMenuIndex === null) {
                setHoveredIndex(null);
              }
            }}
            onMouseMove={() => {
              if (selectedIndex !== null && contextMenuIndex === null) {
                setSelectedIndex(null);
                setHoveredIndex(index);
              }
            }}
            draggable
            onDragStart={handleDragStart}
            onDragOver={(e) => onDragOver(e, index)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, index)}
            onDragEnd={onDragEnd}
          >
            {showTopIndicator && (
              <Box className="absolute top-0 right-0 left-0 z-10 h-0.5 bg-accent-8" />
            )}

            {showBottomIndicator && (
              <Box className="absolute right-0 bottom-0 left-0 z-10 h-0.5 bg-accent-8" />
            )}
            <Flex align="baseline" gap="2" style={{ minWidth: 0 }}>
              <Text color="gray" size="1" style={{ flexShrink: 0 }}>
                {isHighlighted ? "[•]" : "[ ]"}
              </Text>

              <Code
                size="1"
                color="gray"
                variant="ghost"
                style={{ flexShrink: 0 }}
              >
                {task.slug}
              </Code>

              <Badge
                color={statusColorMap[status] || "gray"}
                size="1"
                style={{ flexShrink: 0 }}
              >
                {status}
              </Badge>

              <Flex
                align="center"
                gap="2"
                className="flex-1"
                style={{ minWidth: 0 }}
              >
                <Text
                  size="1"
                  className="overflow-hidden text-ellipsis whitespace-nowrap"
                  style={{ minWidth: 0 }}
                >
                  {task.title}
                </Text>
                {hasPR && (
                  <Flex
                    align="center"
                    gap="1"
                    onClick={isHighlighted ? handleOpenPR : undefined}
                    className={
                      isHighlighted
                        ? "cursor-pointer rounded border border-gray-6 px-1"
                        : ""
                    }
                    style={{
                      flexShrink: 0,
                      fontFamily: "var(--font-mono)",
                      opacity: isHighlighted ? 1 : 0,
                      pointerEvents: isHighlighted ? "auto" : "none",
                    }}
                  >
                    <GitPullRequest
                      size={14}
                      weight="light"
                      className="text-gray-11"
                    />
                    <Text size="1" color="gray">
                      Open pull request
                    </Text>
                  </Flex>
                )}
              </Flex>

              {task.repository_config && (
                <Text
                  size="1"
                  color="gray"
                  className="whitespace-nowrap"
                  style={{ flexShrink: 0 }}
                >
                  {task.repository_config.organization}/
                  {task.repository_config.repository}
                </Text>
              )}

              <Text
                size="1"
                color="gray"
                className="whitespace-nowrap text-gray-8"
                style={{ flexShrink: 0 }}
              >
                {timeDisplay}
              </Text>
            </Flex>
          </Box>
        </ContextMenu.Trigger>
        <ContextMenu.Content>
          <ContextMenu.Item onSelect={handleDuplicate} shortcut="⌘ D">
            <Flex align="center" gap="2">
              <CopyIcon />
              Duplicate task
            </Flex>
          </ContextMenu.Item>
          <ContextMenu.Separator />

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger>Move</ContextMenu.SubTrigger>
            <ContextMenu.SubContent>
              <ContextMenu.Item
                onSelect={() => onMoveTask(index, 0)}
                shortcut="⌥ ⇧ ↑"
              >
                Move to top
              </ContextMenu.Item>
              <ContextMenu.Item
                onSelect={() => onMoveTask(index, Math.max(0, index - 1))}
                shortcut="⌥ ↑"
              >
                Move up
              </ContextMenu.Item>
              <ContextMenu.Item
                onSelect={() =>
                  onMoveTask(
                    index,
                    Math.min(filteredTasksLength - 1, index + 1),
                  )
                }
                shortcut="⌥ ↓"
              >
                Move down
              </ContextMenu.Item>
              <ContextMenu.Item
                onSelect={() => onMoveTask(index, filteredTasksLength - 1)}
                shortcut="⌥ ⇧ ↓"
              >
                Move to bottom
              </ContextMenu.Item>
            </ContextMenu.SubContent>
          </ContextMenu.Sub>
          <ContextMenu.Separator />

          <ContextMenu.Item onSelect={handleDelete} color="red" shortcut="⌘ ⌫">
            <Flex align="center" gap="2">
              <TrashIcon />
              Delete task
            </Flex>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
    </>
  );
}

export const TaskItem = memo(TaskItemComponent);
