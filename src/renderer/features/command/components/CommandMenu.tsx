import { Command } from "@features/command/components/Command";
import { CommandKeyHints } from "@features/command/components/CommandKeyHints";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { MicrophoneIcon } from "@phosphor-icons/react";
import { FileTextIcon, ListBulletIcon } from "@radix-ui/react-icons";
import { Flex, Text } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useLayoutStore } from "@stores/layoutStore";
import { useTabStore } from "@stores/tabStore";
import { useCallback, useEffect, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const { tabs, setActiveTab, createTab } = useTabStore();
  const { setCliMode } = useLayoutStore();
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

  const handleNavigateToRecordings = () => {
    const recordingsTab = tabs.find((tab) => tab.type === "recordings");
    if (recordingsTab) {
      setActiveTab(recordingsTab.id);
    } else {
      createTab({
        type: "recordings",
        title: "Recordings",
      });
    }
    onOpenChange(false);
  };

  const handleCreateTask = () => {
    // Find the Tasks tab or use the first task-list tab
    const tasksTab = tabs.find((tab) => tab.type === "task-list");

    if (tasksTab) {
      setActiveTab(tasksTab.id);
    }

    // Switch to task mode
    setCliMode("task");

    // Close the command menu
    onOpenChange(false);

    // Note: The auto-focus effect in CliTaskPanel will handle focusing the editor
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
      <div
        ref={commandRef}
        className="flex w-[640px] max-w-[90vw] flex-col overflow-hidden rounded-2 border border-gray-6 bg-gray-1 shadow-6"
      >
        <Command.Root className="min-h-0 flex-1">
          <div className="flex items-center border-gray-6 border-b px-3">
            <Command.Input
              placeholder="Search for tasks, navigate to sections..."
              autoFocus={true}
              style={{ fontSize: "12px" }}
              className="w-full bg-transparent py-3 outline-none placeholder:text-gray-9"
            />
          </div>

          <Command.List style={{ maxHeight: "400px" }}>
            <Command.Empty>No results found.</Command.Empty>

            <Command.Group heading="Actions">
              <Command.Item value="Create new task" onSelect={handleCreateTask}>
                <FileTextIcon className="mr-3 h-3 w-3 text-gray-11" />
                <Text size="1">Create new task</Text>
              </Command.Item>
            </Command.Group>

            <Command.Group heading="Navigation">
              <Command.Item
                value="Go to tasks"
                onSelect={handleNavigateToTasks}
              >
                <ListBulletIcon className="mr-3 h-3 w-3 text-gray-11" />
                <Text size="1">Go to tasks</Text>
              </Command.Item>

              <Command.Item
                value="Go to recordings"
                onSelect={handleNavigateToRecordings}
              >
                <MicrophoneIcon className="mr-3 h-3 w-3 text-gray-11" />
                <Text size="1">Go to recordings</Text>
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
                      <Text size="1" weight="medium" className="truncate">
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
        </Command.Root>

        <CommandKeyHints />
      </div>
    </Flex>
  );
}
