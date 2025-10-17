import type { TabState } from "@shared/types";
import { v4 as uuidv4 } from "uuid";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface TabStore {
  tabs: TabState[];
  activeTabId: string;

  createTab: (tab: Omit<TabState, "id">) => void;
  closeTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

// Create initial tabs
const createInitialTabs = (): [TabState, TabState, TabState] => {
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

  const recordingsTab: TabState = {
    id: uuidv4(),
    type: "recordings",
    title: "Recordings",
  };

  return [taskListTab, workflowTab, recordingsTab];
};

const [initialTaskListTab, initialWorkflowTab, initialRecordingsTab] =
  createInitialTabs();

export const useTabStore = create<TabStore>()(
  persist(
    (set, get) => ({
      tabs: [initialTaskListTab, initialWorkflowTab, initialRecordingsTab],
      activeTabId: initialTaskListTab.id,

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

      closeOtherTabs: (tabId) => {
        const state = get();

        // Ensure we have more than one tab
        if (state.tabs.length === 1) return;

        // Keep only the tab with the specified tabId
        const tabToKeep = state.tabs.find((tab) => tab.id === tabId);

        if (!tabToKeep) return;

        set({
          tabs: [tabToKeep],
          activeTabId: tabId,
        });
      },

      closeTabsToRight: (tabId) => {
        const state = get();
        const tabIndex = state.tabs.findIndex((tab) => tab.id === tabId);

        // If tab not found or it's already the last tab, do nothing
        if (tabIndex === -1 || tabIndex === state.tabs.length - 1) return;

        // Keep only tabs up to and including the specified tab
        const newTabs = state.tabs.slice(0, tabIndex + 1);
        let newActiveTabId = state.activeTabId;

        // If the active tab was closed, select the rightmost remaining tab
        const activeTabStillExists = newTabs.some(
          (tab) => tab.id === state.activeTabId,
        );
        if (!activeTabStillExists) {
          newActiveTabId = newTabs[newTabs.length - 1].id;
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
    }),
    {
      name: "tab-store",
    },
  ),
);
