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
    <div className="drag flex bg-dark-surface border-b border-dark-border h-10 overflow-x-auto">
      {/* Spacer for macOS window controls */}
      <div className="w-20 shrink-0" />

      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={clsx(
            'no-drag flex items-center px-4 cursor-pointer border-r border-dark-border group min-w-0',
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
              <svg fill="#FFFFFF" height="12" width="12" version="1.1"
                viewBox="0 0 460.775 460.775">
                <path d="M285.08,230.397L456.218,59.27c6.076-6.077,6.076-15.911,0-21.986L423.511,4.565c-2.913-2.911-6.866-4.55-10.992-4.55
	c-4.127,0-8.08,1.639-10.993,4.55l-171.138,171.14L59.25,4.565c-2.913-2.911-6.866-4.55-10.993-4.55
	c-4.126,0-8.08,1.639-10.992,4.55L4.558,37.284c-6.077,6.075-6.077,15.909,0,21.986l171.138,171.128L4.575,401.505
	c-6.074,6.077-6.074,15.911,0,21.986l32.709,32.719c2.911,2.911,6.865,4.55,10.992,4.55c4.127,0,8.08-1.639,10.994-4.55
	l171.117-171.12l171.118,171.12c2.913,2.911,6.866,4.55,10.993,4.55c4.128,0,8.081-1.639,10.992-4.55l32.709-32.719
	c6.074-6.075,6.074-15.909,0-21.986L285.08,230.397z"/>
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}