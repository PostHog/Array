import {
  ComponentInstanceIcon,
  FileTextIcon,
  ListBulletIcon,
} from "@radix-ui/react-icons";
import { Flex, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import type { Task } from "@/shared/types";
import { useTasks } from "../../hooks/useTasks";
import { useTabStore } from "../../stores/tabStore";
import { Command } from "./Command";
import { CommandKeyHints } from "./CommandKeyHints";

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateTask?: () => void;
}

export function CommandMenu({
  open,
  onOpenChange,
  onCreateTask,
}: CommandMenuProps) {
  const { tabs, setActiveTab, createTab } = useTabStore();
  const { data: tasks = [] } = useTasks();
  const commandRef = useRef<HTMLDivElement>(null);

  // Close handlers
  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  useHotkeys("escape", handleClose, {
    enabled: open,
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true,
  });

  useHotkeys("mod+k", handleClose, {
    enabled: open,
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true,
  });

  useHotkeys("mod+p", handleClose, {
    enabled: open,
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true,
  });

  // Handle click outside
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        commandRef.current &&
        !commandRef.current.contains(event.target as Node)
      ) {
        onOpenChange(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open, onOpenChange]);

  const handleNavigateToTasks = () => {
    const tasksTab = tabs.find((tab) => tab.type === "task-list");
    if (tasksTab) {
      setActiveTab(tasksTab.id);
    } else {
      createTab({
        type: "task-list",
        title: "Tasks",
      });
    }
    onOpenChange(false);
  };

  const handleNavigateToWorkflow = () => {
    const workflowTab = tabs.find((tab) => tab.type === "workflow");
    if (workflowTab) {
      setActiveTab(workflowTab.id);
    } else {
      createTab({
        type: "workflow",
        title: "Workflows",
      });
    }
    onOpenChange(false);
  };

  const handleCreateTask = () => {
    onOpenChange(false);
    onCreateTask?.();
  };

  const handleNavigateToTask = (task: {
    id: string;
    title: string;
    description?: string;
  }) => {
    // Check if task is already open in a tab
    const existingTab = tabs.find(
      (tab) => tab.type === "task-detail" && (tab.data as Task)?.id === task.id,
    );

    if (existingTab) {
      setActiveTab(existingTab.id);
    } else {
      createTab({
        type: "task-detail",
        title: task.title,
        data: task,
      });
    }
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <Flex
      align="start"
      justify="center"
      className="fixed inset-0 z-50 bg-black/20"
      pt="9"
    >
      <Command.Root ref={commandRef} className="w-[640px] max-w-[90vw]">
        <Command.Input
          placeholder="Search for tasks, navigate to sections..."
          autoFocus={true}
        />

        <Command.List>
          <Command.Empty>No results found.</Command.Empty>

          <Command.Group heading="Actions">
            <Command.Item value="Create new task" onSelect={handleCreateTask}>
              <FileTextIcon className="mr-3 h-4 w-4 text-gray-11" />
              <Text size="2">Create new task</Text>
            </Command.Item>
          </Command.Group>

          <Command.Group heading="Navigation">
            <Command.Item value="Go to tasks" onSelect={handleNavigateToTasks}>
              <ListBulletIcon className="mr-3 h-4 w-4 text-gray-11" />
              <Text size="2">Go to tasks</Text>
            </Command.Item>

            <Command.Item
              value="Go to workflows"
              onSelect={handleNavigateToWorkflow}
            >
              <ComponentInstanceIcon className="mr-3 h-4 w-4 text-gray-11" />
              <Text size="2">Go to workflows</Text>
            </Command.Item>
          </Command.Group>

          {tasks.length > 0 && (
            <Command.Group heading="Tasks">
              {tasks.map((task) => (
                <Command.Item
                  key={task.id}
                  value={`${task.id} ${task.title}`}
                  onSelect={() => handleNavigateToTask(task)}
                  className="items-start"
                >
                  <FileTextIcon className="mt-0.5 mr-3 h-4 w-4 flex-shrink-0 text-gray-11" />
                  <Flex direction="column" flexGrow="1" className="min-w-0">
                    <Text size="2" weight="medium" className="truncate">
                      {task.title}
                    </Text>
                    {task.description && (
                      <Text size="1" color="gray" className="mt-1 truncate">
                        {task.description}
                      </Text>
                    )}
                  </Flex>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>

        <CommandKeyHints />
      </Command.Root>
    </Flex>
  );
}
