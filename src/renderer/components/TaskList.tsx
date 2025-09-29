import React, { useEffect, useCallback, useState, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Flex, Box, Text, TextField, Button, Badge, Spinner, Kbd } from '@radix-ui/themes';
import { Task } from '@shared/types';
import { useTaskStore } from '../stores/taskStore';
import { formatDistanceToNow } from 'date-fns';

interface TaskListProps {
  onSelectTask: (task: Task) => void;
}

export function TaskList({ onSelectTask }: TaskListProps) {
  const { tasks, fetchTasks, isLoading, error } = useTaskStore();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);
  
  const filteredTasks = tasks
    .filter(task => 
      task.title.toLowerCase().includes(filter.toLowerCase()) ||
      task.description?.toLowerCase().includes(filter.toLowerCase())
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  
  const handleKeyNavigation = useCallback((direction: 'up' | 'down') => {
    setSelectedIndex(prev => {
      if (direction === 'up') {
        return Math.max(0, prev - 1);
      } else {
        return Math.min(filteredTasks.length - 1, prev + 1);
      }
    });
  }, [filteredTasks.length]);
  
  const handleSelectCurrent = useCallback(() => {
    if (filteredTasks[selectedIndex]) {
      onSelectTask(filteredTasks[selectedIndex]);
    }
  }, [filteredTasks, selectedIndex, onSelectTask]);
  
  // Keyboard shortcuts
  useHotkeys('up', () => handleKeyNavigation('up'), [handleKeyNavigation]);
  useHotkeys('down', () => handleKeyNavigation('down'), [handleKeyNavigation]);
  useHotkeys('enter', handleSelectCurrent, [handleSelectCurrent]);
  useHotkeys('cmd+r, ctrl+r', () => fetchTasks(), [fetchTasks]);
  
  // Scroll selected item into view
  useEffect(() => {
    const container = listRef.current;
    const selectedElement = container?.children[selectedIndex] as HTMLElement;
    
    if (selectedElement && container) {
      const containerRect = container.getBoundingClientRect();
      const elementRect = selectedElement.getBoundingClientRect();
      
      if (elementRect.bottom > containerRect.bottom) {
        selectedElement.scrollIntoView({ block: 'end', behavior: 'smooth' });
      } else if (elementRect.top < containerRect.top) {
        selectedElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);
  
  if (isLoading && tasks.length === 0) {
    return (
      <Flex align="center" justify="center" >
        <Flex align="center" gap="3">
          <Spinner size="3" />
          <Text color="gray">Loading tasks...</Text>
        </Flex>
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex direction="column" align="center" justify="center">
        <Text color="red">{error}</Text>
        <Button onClick={() => fetchTasks()}>
          Retry
        </Button>
      </Flex>
    );
  }
  
  return (
    <Flex direction="column" height="100%">
      <Box py="4" className="border-b border-gray-6">
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
              {filter ? 'No tasks match your filter' : 'No tasks found'}
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

      <Box p="2" className="border-t border-gray-6">
        <Flex justify="between">
          <Text size="1" color="gray">{filteredTasks.length} tasks</Text>
          <Flex align="center" gap="2">
            <Kbd>↑↓</Kbd>
            <Text size="1" color="gray">Navigate</Text>
            <Text size="1" color="gray">·</Text>
            <Kbd>↵</Kbd>
            <Text size="1" color="gray">Open</Text>
            <Text size="1" color="gray">·</Text>
            <Kbd>⌘R</Kbd>
            <Text size="1" color="gray">Refresh</Text>
          </Flex>
        </Flex>
      </Box>
    </Flex>
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
  const status = 'Backlog';

  return (
    <Box
      p="2"
      className={`border-b border-gray-6 cursor-pointer font-mono ${
        isSelected ? 'bg-gray-3' : ''
      }`}
      onClick={onClick}
    >
      <Flex align="center" gap="2">
        <Text color="gray" size="2">
          {isSelected ? '[•]' : '[ ]'}
        </Text>

        <Badge
          color={status === 'Backlog' ? 'gray' : 'orange'}
          size="1"
        >
          {status}
        </Badge>

        <Text className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {task.title}
        </Text>

        {task.repository_config && (
          <Text size="1" color="gray">
            {task.repository_config.organization}/{task.repository_config.repository}
          </Text>
        )}

        <Text size="1" color="gray" className="whitespace-nowrap">
          {timeAgo}
        </Text>
      </Flex>
    </Box>
  );
}