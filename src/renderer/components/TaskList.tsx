import React, { useEffect, useCallback, useState, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Task } from '@shared/types';
import { useTaskStore } from '../stores/taskStore';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

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
      <div className="flex items-center justify-center h-full">
        <div className="text-dark-text-muted">Loading tasks...</div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <div className="text-red-400 mb-4">{error}</div>
        <button
          onClick={() => fetchTasks()}
          className="px-4 py-2 bg-dark-surface hover:bg-dark-border rounded-md transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-full bg-dark-bg">
      <div className="py-4 border-b border-dark-border">
        <input
          type="text"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setSelectedIndex(0);
          }}
          placeholder="Filter tasks..."
          className="w-full px-3 py-2 bg-dark-surface border border-dark-border rounded-md text-dark-text placeholder-dark-text-muted focus:ring-2 focus:ring-posthog-500 focus:border-transparent"
        />
      </div>
      
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {filteredTasks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-dark-text-muted">
            {filter ? 'No tasks match your filter' : 'No tasks found'}
          </div>
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
              onMouseEnter={() => setSelectedIndex(index)}
            />
          ))
        )}
      </div>
      
      <div className="p-2 border-t border-dark-border text-xs text-dark-text-muted">
        <div className="flex justify-between">
          <span>{filteredTasks.length} tasks</span>
          <span>↑↓ Navigate · ↵ Open · ⌘R Refresh</span>
        </div>
      </div>
    </div>
  );
}

interface TaskItemProps {
  task: Task;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}

function TaskItem({ task, isSelected, onClick, onMouseEnter }: TaskItemProps) {
  const createdAt = new Date(task.created_at);
  const timeAgo = formatDistanceToNow(createdAt, { addSuffix: true });
  
  // TODO: Look up stage name from workflow data
  const status = 'Backlog';
  
  return (
    <div
      className={clsx(
        'px-2 py-1 border-b border-dark-border cursor-pointer transition-colors font-mono text-sm',
        isSelected ? 'bg-dark-surface' : 'hover:bg-dark-surface/50'
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div className="flex items-center gap-2">
        <span className="text-dark-text-muted">
          {isSelected ? '[•]' : '[ ]'}
        </span>
        
        <span className={clsx(
          'px-1 py-0 rounded text-xs min-w-fit',
          status === 'Backlog' 
            ? 'bg-gray-800 text-gray-300'
            : 'bg-posthog-900/30 text-posthog-400'
        )}>
          {status}
        </span>
        
        <span className="text-dark-text flex-1 truncate">
          {task.title}
        </span>
        
        {task.repository_config && (
          <span className="text-dark-text-muted text-xs">
            {task.repository_config.organization}/{task.repository_config.repository}
          </span>
        )}
        
        <span className="text-xs text-dark-text-muted whitespace-nowrap">
          {timeAgo}
        </span>
      </div>
    </div>
  );
}