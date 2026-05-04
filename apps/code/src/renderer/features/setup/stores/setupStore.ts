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
  discoveryFeed: AgentFeedState;
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
  addEnricherSuggestionIfMissing: (task: DiscoveredTask) => void;
  pushDiscoveryActivity: (entry: ActivityEntry) => void;
  resetSetup: () => void;
}

type SetupStore = SetupStoreState & SetupStoreActions;

const initialState: SetupStoreState = {
  discoveredTasks: [],
  discoveryStatus: "idle",
  discoveryTaskId: null,
  discoveryTaskRunId: null,
  discoveryFeed: EMPTY_FEED,
  error: null,
  selectedDiscoveredTaskId: null,
};

// Discovery resets only clear agent-source suggestions; enricher-source
// suggestions are deterministic and survive across runs.
function keepEnricherSuggestions(tasks: DiscoveredTask[]): DiscoveredTask[] {
  return tasks.filter((t) => t.source === "enricher");
}

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

      // Starts a fresh agent run. Clears agent-source suggestions only —
      // enricher-source suggestions persist across discovery runs.
      startDiscovery: (taskId, taskRunId) => {
        log.info("Discovery started", { taskId, taskRunId });
        set((state) => ({
          discoveryStatus: "running",
          discoveryTaskId: taskId,
          discoveryTaskRunId: taskRunId,
          discoveredTasks: keepEnricherSuggestions(state.discoveredTasks),
          discoveryFeed: EMPTY_FEED,
          error: null,
        }));
      },

      // Replaces only agent-source entries with the new findings; enricher
      // entries stay put and continue to render first.
      completeDiscovery: (tasks) => {
        log.info("Discovery completed", { taskCount: tasks.length });
        set((state) => {
          const enricher = keepEnricherSuggestions(state.discoveredTasks);
          const agent = tasks.map((t) => ({ ...t, source: "agent" as const }));
          return {
            discoveryStatus: "done",
            discoveredTasks: [...enricher, ...agent],
            error: null,
          };
        });
      },

      failDiscovery: (message) => {
        log.warn("Discovery failed", { message });
        set({ discoveryStatus: "error", error: message ?? null });
      },

      resetDiscovery: () => {
        log.info("Discovery reset");
        set((state) => ({
          discoveryStatus: "idle",
          discoveryTaskId: null,
          discoveryTaskRunId: null,
          discoveredTasks: keepEnricherSuggestions(state.discoveredTasks),
          discoveryFeed: EMPTY_FEED,
          error: null,
        }));
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

      // Adds an enricher-source suggestion if there isn't already one with
      // the same id. Idempotent — safe to call repeatedly on every detection
      // run. Dismissed suggestions stay dismissed until `resetSetup`.
      addEnricherSuggestionIfMissing: (task) => {
        set((state) => {
          if (state.discoveredTasks.some((t) => t.id === task.id)) {
            return state;
          }
          return {
            discoveredTasks: [
              { ...task, source: "enricher" as const },
              ...state.discoveredTasks,
            ],
          };
        });
      },

      pushDiscoveryActivity: (entry) => {
        set((state) => ({
          discoveryFeed: pushEntry(state.discoveryFeed, entry),
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
