import type { DiscoveredTask } from "@features/setup/types";
import { logger } from "@utils/logger";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const log = logger.scope("setup-store");

type DiscoveryStatus = "idle" | "running" | "done" | "error";

interface ActivityEntry {
  id: number;
  toolCallId: string;
  tool: string;
  filePath: string | null;
  title: string;
}

export interface AgentFeedState {
  currentTool: string | null;
  currentFilePath: string | null;
  recentEntries: ActivityEntry[];
}

const EMPTY_FEED: AgentFeedState = {
  currentTool: null,
  currentFilePath: null,
  recentEntries: [],
};

interface SetupStoreState {
  discoveredTasks: DiscoveredTask[];
  discoveryStatus: DiscoveryStatus;
  discoveryTaskId: string | null;
  discoveryTaskRunId: string | null;
  wizardTaskId: string | null;
  wizardSkipped: boolean;
  wizardCompleted: boolean;
  discoveryFeed: AgentFeedState;
  wizardFeed: AgentFeedState;
  error: string | null;
  selectedDiscoveredTaskId: string | null;
}

interface SetupStoreActions {
  startDiscovery: (taskId: string, taskRunId: string) => void;
  completeDiscovery: (tasks: DiscoveredTask[]) => void;
  failDiscovery: (message?: string) => void;
  resetDiscovery: () => void;
  removeDiscoveredTask: (taskId: string) => void;
  selectDiscoveredTask: (taskId: string | null) => void;
  setWizardTaskId: (taskId: string) => void;
  skipWizard: () => void;
  completeWizard: () => void;
  pushDiscoveryActivity: (entry: ActivityEntry) => void;
  pushWizardActivity: (entry: ActivityEntry) => void;
  /** Wipes all setup state — discovered tasks, wizard, feeds, selection. */
  resetSetup: () => void;
}

type SetupStore = SetupStoreState & SetupStoreActions;

const initialState: SetupStoreState = {
  discoveredTasks: [],
  discoveryStatus: "idle",
  discoveryTaskId: null,
  discoveryTaskRunId: null,
  wizardTaskId: null,
  wizardSkipped: false,
  wizardCompleted: false,
  discoveryFeed: EMPTY_FEED,
  wizardFeed: EMPTY_FEED,
  error: null,
  selectedDiscoveredTaskId: null,
};

function pushEntry(prev: AgentFeedState, entry: ActivityEntry): AgentFeedState {
  const existingIdx = entry.toolCallId
    ? prev.recentEntries.findIndex((e) => e.toolCallId === entry.toolCallId)
    : -1;

  let newEntries: ActivityEntry[];
  if (existingIdx >= 0) {
    newEntries = [...prev.recentEntries];
    const old = newEntries[existingIdx];
    newEntries[existingIdx] = {
      ...old,
      tool: entry.tool || old.tool,
      filePath: entry.filePath || old.filePath,
      title: entry.title || old.title,
    };
  } else {
    newEntries = [...prev.recentEntries.slice(-4), entry];
  }

  return {
    currentTool: entry.tool,
    currentFilePath: entry.filePath ?? prev.currentFilePath,
    recentEntries: newEntries,
  };
}

export const useSetupStore = create<SetupStore>()(
  persist(
    (set) => ({
      ...initialState,

      startDiscovery: (taskId, taskRunId) => {
        log.info("Discovery started", { taskId, taskRunId });
        set({
          discoveryStatus: "running",
          discoveryTaskId: taskId,
          discoveryTaskRunId: taskRunId,
          discoveredTasks: [],
          discoveryFeed: EMPTY_FEED,
          error: null,
        });
      },

      completeDiscovery: (tasks) => {
        log.info("Discovery completed", { taskCount: tasks.length });
        set({
          discoveryStatus: "done",
          discoveredTasks: tasks,
          error: null,
        });
      },

      failDiscovery: (message) => {
        log.warn("Discovery failed", { message });
        set({ discoveryStatus: "error", error: message ?? null });
      },

      resetDiscovery: () => {
        log.info("Discovery reset");
        set({
          discoveryStatus: "idle",
          discoveryTaskId: null,
          discoveryTaskRunId: null,
          discoveredTasks: [],
          discoveryFeed: EMPTY_FEED,
          error: null,
        });
      },

      removeDiscoveredTask: (taskId) => {
        set((state) => ({
          discoveredTasks: state.discoveredTasks.filter((t) => t.id !== taskId),
          selectedDiscoveredTaskId:
            state.selectedDiscoveredTaskId === taskId
              ? null
              : state.selectedDiscoveredTaskId,
        }));
      },

      selectDiscoveredTask: (taskId) => {
        set({ selectedDiscoveredTaskId: taskId });
      },

      setWizardTaskId: (taskId) => {
        log.info("Wizard task created", { taskId });
        set({ wizardTaskId: taskId });
      },

      skipWizard: () => {
        log.info("Wizard skipped (PostHog already installed)");
        set({ wizardSkipped: true });
      },

      completeWizard: () => {
        log.info("Wizard task reached terminal status");
        set({ wizardCompleted: true });
      },

      pushDiscoveryActivity: (entry) => {
        set((state) => ({
          discoveryFeed: pushEntry(state.discoveryFeed, entry),
        }));
      },

      pushWizardActivity: (entry) => {
        set((state) => ({
          wizardFeed: pushEntry(state.wizardFeed, entry),
        }));
      },

      resetSetup: () => {
        log.info("Setup state reset");
        set({ ...initialState });
      },
    }),
    {
      name: "setup-store",
      partialize: (state) => ({
        discoveredTasks: state.discoveredTasks,
        discoveryStatus:
          state.discoveryStatus === "done"
            ? ("done" as const)
            : ("idle" as const),
      }),
    },
  ),
);
