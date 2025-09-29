import React, { useEffect, useRef, useCallback } from 'react';
import { Flex, Text } from '@radix-ui/themes';
import { Command } from './Command';
import { CommandKeyHints } from './CommandKeyHints';
import { useTabStore } from '../../stores/tabStore';
import { useTaskStore } from '../../stores/taskStore';
import { useHotkeys } from 'react-hotkeys-hook';
import { ListBulletIcon, ComponentInstanceIcon, FileTextIcon } from '@radix-ui/react-icons';

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const { tabs, setActiveTab, createTab } = useTabStore();
  const { tasks, fetchTasks } = useTaskStore();
  const commandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      fetchTasks();
    }
  }, [open, fetchTasks]);

  // Close handlers
  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  useHotkeys('escape', handleClose, {
    enabled: open,
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true
  });

  useHotkeys('mod+k', handleClose, {
    enabled: open,
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true
  });

  useHotkeys('mod+p', handleClose, {
    enabled: open,
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true
  });

  // Handle click outside
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (commandRef.current && !commandRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onOpenChange]);

  const handleNavigateToTasks = () => {
    const tasksTab = tabs.find(tab => tab.type === 'task-list');
    if (tasksTab) {
      setActiveTab(tasksTab.id);
    } else {
      createTab({
        type: 'task-list',
        title: 'Tasks',
      });
    }
    onOpenChange(false);
  };

  const handleNavigateToWorkflow = () => {
    const workflowTab = tabs.find(tab => tab.type === 'workflow');
    if (workflowTab) {
      setActiveTab(workflowTab.id);
    } else {
      createTab({
        type: 'workflow',
        title: 'Workflow',
      });
    }
    onOpenChange(false);
  };

  const handleNavigateToTask = (task: { id: string; title: string; description?: string }) => {
    // Check if task is already open in a tab
    const existingTab = tabs.find(tab =>
      tab.type === 'task-detail' && tab.data?.id === task.id
    );

    if (existingTab) {
      setActiveTab(existingTab.id);
    } else {
      createTab({
        type: 'task-detail',
        title: task.title,
        data: task,
      });
    }
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <Flex align="start" justify="center" className="fixed inset-0 z-50 bg-black/20" pt="9">
      <Command.Root ref={commandRef} className="w-[640px] max-w-[90vw]">
        <Command.Input
          placeholder="Search for tasks, navigate to sections..."
          autoFocus={true}
        />

        <Command.List>
          <Command.Empty>No results found.</Command.Empty>

          <Command.Group heading="Navigation">
            <Command.Item value="tasks" onSelect={handleNavigateToTasks}>
              <ListBulletIcon className="w-4 h-4 mr-3 text-gray-11" />
              <Text size="2">Tasks</Text>
            </Command.Item>

            <Command.Item value="workflow" onSelect={handleNavigateToWorkflow}>
              <ComponentInstanceIcon className="w-4 h-4 mr-3 text-gray-11" />
              <Text size="2">Workflow</Text>
            </Command.Item>
          </Command.Group>

          {tasks.length > 0 && (
            <Command.Group heading="Tasks">
              {tasks.map((task) => (
                <Command.Item
                  key={task.id}
                  value={task.title}
                  onSelect={() => handleNavigateToTask(task)}
                  className="items-start"
                >
                  <FileTextIcon className="w-4 h-4 mr-3 mt-0.5 text-gray-11 flex-shrink-0" />
                  <Flex direction="column" flexGrow="1" className="min-w-0">
                    <Text size="2" weight="medium" className="truncate">{task.title}</Text>
                    {task.description && (
                      <Text size="1" color="gray" className="truncate mt-1">
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