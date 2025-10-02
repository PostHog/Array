import type { TabState } from "@shared/types";
import { v4 as uuidv4 } from "uuid";
import { create } from "zustand";

interface TabStore {
  tabs: TabState[];
  activeTabId: string;

  createTab: (tab: Omit<TabState, "id">) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

// Create initial tabs
const taskListTab: TabState = {
  id: uuidv4(),
  type: "task-list",
  title: "Tasks",
};

const workflowTab: TabState = {
  id: uuidv4(),
  type: "workflow",
  title: "Workflows",
};

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [taskListTab, workflowTab],
  activeTabId: taskListTab.id,

  createTab: (tabData) => {
    const newTab: TabState = {
      ...tabData,
      id: uuidv4(),
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
  },

  closeTab: (tabId) => {
    const state = get();
    const tabIndex = state.tabs.findIndex((tab) => tab.id === tabId);

    if (tabIndex === -1 || state.tabs.length === 1) return;

    const newTabs = state.tabs.filter((tab) => tab.id !== tabId);
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

  updateTabTitle: (tabId, title) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, title } : tab,
      ),
    }));
  },

  reorderTabs: (fromIndex, toIndex) => {
    set((state) => {
      const newTabs = [...state.tabs];
      const [movedTab] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, movedTab);
      return { tabs: newTabs };
    });
  },
}));
