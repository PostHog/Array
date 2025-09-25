import React from 'react';
import { TaskList } from './TaskList';
import { TaskDetail } from './TaskDetail';
import { TabBar } from './TabBar';
import { useTabStore } from '../stores/tabStore';
import { Task } from '@shared/types';

export function MainLayout() {
  const { activeTabId, tabs, createTab, setActiveTab } = useTabStore();
  
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
    <div className="flex flex-col h-screen bg-dark-bg">
      <TabBar />
      
      <div className="flex-1 overflow-hidden">
        {activeTab?.type === 'task-list' && (
          <div className="h-full px-6">
            <TaskList onSelectTask={handleSelectTask} />
          </div>
        )}
        
        {activeTab?.type === 'task-detail' && activeTab.data && (
          <TaskDetail task={activeTab.data} />
        )}
      </div>
    </div>
  );
}