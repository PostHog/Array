import { create } from 'zustand';
import { TabState } from '@shared/types';
import { v4 as uuidv4 } from 'uuid';

interface TabStore {
  tabs: TabState[];
  activeTabId: string;
  
  createTab: (tab: Omit<TabState, 'id'>) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
}

// Create initial task list tab
const initialTab: TabState = {
  id: uuidv4(),
  type: 'task-list',
  title: 'Tasks',
};

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  
  createTab: (tabData) => {
    const newTab: TabState = {
      ...tabData,
      id: uuidv4(),
    };
    
    set(state => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
  },
  
  closeTab: (tabId) => {
    const state = get();
    const tabIndex = state.tabs.findIndex(tab => tab.id === tabId);
    
    if (tabIndex === -1 || state.tabs.length === 1) return;
    
    const newTabs = state.tabs.filter(tab => tab.id !== tabId);
    let newActiveTabId = state.activeTabId;
    
    if (state.activeTabId === tabId) {
      // Select the tab to the left, or the first tab if closing the leftmost
      const newIndex = Math.max(0, tabIndex - 1);
      newActiveTabId = newTabs[newIndex].id;
    }
    
    set({
      tabs: newTabs,
      activeTabId: newActiveTabId,
    });
  },
  
  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
  },
}));