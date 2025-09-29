import React, { useState } from 'react';
import { Flex, Box } from '@radix-ui/themes';
import { TaskList } from './TaskList';
import { TaskDetail } from './TaskDetail';
import { WorkflowView } from './WorkflowView';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';
import { CommandMenu } from './command';
import { useTabStore } from '../stores/tabStore';
import { useHotkeys } from 'react-hotkeys-hook';
import { Task } from '@shared/types';

export function MainLayout() {
  const { activeTabId, tabs, createTab, setActiveTab } = useTabStore();
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);

  useHotkeys('mod+k', () => setCommandMenuOpen(prev => !prev), { enabled: !commandMenuOpen });
  useHotkeys('mod+t', () => setCommandMenuOpen(prev => !prev), { enabled: !commandMenuOpen });
  useHotkeys('mod+p', () => setCommandMenuOpen(prev => !prev), { enabled: !commandMenuOpen });

  const handleSelectTask = (task: Task) => {
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
  };

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  return (
    <Flex direction="column" height="100vh">
      <TabBar />

      <Box flexGrow="1" overflow="hidden">
        {activeTab?.type === 'task-list' && (
          <TaskList onSelectTask={handleSelectTask} />
        )}

        {activeTab?.type === 'task-detail' && activeTab.data && (
          <TaskDetail task={activeTab.data} />
        )}

        {activeTab?.type === 'workflow' && (
          <WorkflowView onSelectTask={handleSelectTask} />
        )}
      </Box>

      <StatusBar />

      <CommandMenu
        open={commandMenuOpen}
        onOpenChange={setCommandMenuOpen}
      />
    </Flex>
  );
}