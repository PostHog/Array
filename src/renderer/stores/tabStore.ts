import type { TabState } from "@shared/types";
import { v4 as uuidv4 } from "uuid";
import { create } from "zustand";

interface TabStore {
  tabs: TabState[];
  activeTabId: string;

  createTab: (tab: Omit<TabState, "id">) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  initializeTabs: (enabledSources: string[]) => void;
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
  title: "Workflow",
};

const sourcesTab: TabState = {
  id: uuidv4(),
  type: "sources",
  title: "Sources",
};

const recordingsTab: TabState = {
  id: uuidv4(),
  type: "recordings",
  title: "Recordings",
};

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [taskListTab, workflowTab, sourcesTab],
  activeTabId: taskListTab.id,

  initializeTabs: (enabledSources: string[]) => {
    const state = get();
    const hasRecordingsTab = state.tabs.some((tab) => tab.type === "recordings");
    const shouldHaveRecordingsTab = enabledSources.includes("call_recording");

    if (shouldHaveRecordingsTab && !hasRecordingsTab) {
      // Add recordings tab
      set((state) => ({
        tabs: [...state.tabs, recordingsTab],
      }));
    } else if (!shouldHaveRecordingsTab && hasRecordingsTab) {
      // Remove recordings tab
      const recordingsTabToRemove = state.tabs.find(
        (tab) => tab.type === "recordings",
      );
      if (recordingsTabToRemove) {
        get().closeTab(recordingsTabToRemove.id);
      }
    }
  },

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

  reorderTabs: (fromIndex, toIndex) => {
    set((state) => {
      const newTabs = [...state.tabs];
      const [movedTab] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, movedTab);
      return { tabs: newTabs };
    });
  },
}));
