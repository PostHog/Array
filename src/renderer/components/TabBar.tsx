import React from 'react';
import { useTabStore } from '../stores/tabStore';
import clsx from 'clsx';
import { useHotkeys } from 'react-hotkeys-hook';

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabStore();
  
  // Keyboard shortcuts for tab navigation
  useHotkeys('cmd+shift+[, ctrl+shift+[', () => {
    const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
    if (currentIndex > 0) {
      setActiveTab(tabs[currentIndex - 1].id);
    }
  }, [tabs, activeTabId, setActiveTab]);
  
  useHotkeys('cmd+shift+], ctrl+shift+]', () => {
    const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
    if (currentIndex < tabs.length - 1) {
      setActiveTab(tabs[currentIndex + 1].id);
    }
  }, [tabs, activeTabId, setActiveTab]);
  
  useHotkeys('cmd+w, ctrl+w', () => {
    if (tabs.length > 1) {
      closeTab(activeTabId);
    }
  }, [tabs, activeTabId, closeTab]);
  
  return (
    <div className="flex bg-dark-surface border-b border-dark-border h-10 overflow-x-auto">
      {/* Spacer for macOS window controls */}
      <div className="w-20 shrink-0" />
      
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={clsx(
            'flex items-center px-4 cursor-pointer border-r border-dark-border group min-w-0',
            tab.id === activeTabId
              ? 'bg-dark-bg text-dark-text'
              : 'hover:bg-dark-bg/50 text-dark-text-muted'
          )}
          onClick={() => setActiveTab(tab.id)}
        >
          <span className="text-sm truncate max-w-[200px] mr-2">
            {tab.title}
          </span>
          
          {tabs.length > 1 && (
            <button
              className="ml-auto opacity-0 group-hover:opacity-100 hover:text-dark-text transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M9.5 3.5L6 7L2.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" transform="rotate(45 6 6)" />
                <path d="M9.5 8.5L6 5L2.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" transform="rotate(45 6 6)" />
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}