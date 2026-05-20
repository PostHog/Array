import type { DiscoveredTask } from "@features/setup/types";
import { logger } from "@utils/logger";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const log = logger.scope("setup-store");

type DiscoveryStatus = "idle" | "running" | "done" | "error";
type EnricherStatus = "idle" | "running" | "done" | "error";

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

export interface RepoDiscoveryState {
  status: DiscoveryStatus;
  taskId: string | null;
  taskRunId: string | null;
  feed: AgentFeedState;
  error: string | null;
}

export interface RepoEnricherState {
  status: EnricherStatus;
}

const EMPTY_FEED: AgentFeedState = {
  currentTool: null,
  currentFilePath: null,
  recentEntries: [],
};

const DEFAULT_DISCOVERY: RepoDiscoveryState = {
  status: "idle",
  taskId: null,
  taskRunId: null,
  feed: EMPTY_FEED,
  error: null,
};

const DEFAULT_ENRICHER: RepoEnricherState = { status: "idle" };

interface SetupStoreState {
  discoveredTasks: DiscoveredTask[];
  discoveryByRepo: Record<string, RepoDiscoveryState>;
  enricherByRepo: Record<string, RepoEnricherState>;
  selectedDiscoveredTaskId: string | null;
}

interface SetupStoreActions {
  startDiscovery: (repoPath: string, taskId: string, taskRunId: string) => void;
  completeDiscovery: (repoPath: string, tasks: DiscoveredTask[]) => void;
  failDiscovery: (repoPath: string, message?: string) => void;
  resetDiscovery: (repoPath: string) => void;
  startEnrichment: (repoPath: string) => void;
  completeEnrichment: (repoPath: string) => void;
  failEnrichment: (repoPath: string) => void;
  removeDiscoveredTask: (taskId: string, repoPath: string | null) => void;
  selectDiscoveredTask: (taskId: string | null) => void;
  addEnricherSuggestionIfMissing: (task: DiscoveredTask) => void;
  pushDiscoveryActivity: (repoPath: string, entry: ActivityEntry) => void;
  resetSetup: () => void;
}

type SetupStore = SetupStoreState & SetupStoreActions;

interface PersistedSetupState {
  discoveredTasks: DiscoveredTask[];
  discoveryByRepo: Record<string, RepoDiscoveryState>;
}

const initialState: SetupStoreState = {
  discoveredTasks: [],
  discoveryByRepo: {},
  enricherByRepo: {},
  selectedDiscoveredTaskId: null,
};

export function selectRepoDiscovery(
  state: SetupStoreState,
  repoPath: string | null,
): RepoDiscoveryState {
  if (!repoPath) return DEFAULT_DISCOVERY;
  return state.discoveryByRepo[repoPath] ?? DEFAULT_DISCOVERY;
}

export function selectRepoEnricher(
  state: SetupStoreState,
  repoPath: string | null,
): RepoEnricherState {
  if (!repoPath) return DEFAULT_ENRICHER;
  return state.enricherByRepo[repoPath] ?? DEFAULT_ENRICHER;
}

function isTaskForRepo(task: DiscoveredTask, repoPath: string | null): boolean {
  if (!repoPath) return !task.repoPath;
  return task.repoPath === repoPath;
}

// Discovery resets only clear agent-source suggestions for the affected repo;
// enricher-source suggestions are deterministic and survive across runs.
function dropAgentTasksForRepo(
  tasks: DiscoveredTask[],
  repoPath: string,
): DiscoveredTask[] {
  return tasks.filter(
    (t) => !(t.source === "agent" && isTaskForRepo(t, repoPath)),
  );
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

function updateDiscovery(
  state: SetupStoreState,
  repoPath: string,
  patch: Partial<RepoDiscoveryState>,
): Record<string, RepoDiscoveryState> {
  const prev = state.discoveryByRepo[repoPath] ?? DEFAULT_DISCOVERY;
  return { ...state.discoveryByRepo, [repoPath]: { ...prev, ...patch } };
}

function updateEnricher(
  state: SetupStoreState,
  repoPath: string,
  patch: Partial<RepoEnricherState>,
): Record<string, RepoEnricherState> {
  const prev = state.enricherByRepo[repoPath] ?? DEFAULT_ENRICHER;
  return { ...state.enricherByRepo, [repoPath]: { ...prev, ...patch } };
}

export const useSetupStore = create<SetupStore>()(
  persist(
    (set) => ({
      ...initialState,

      // Starts a fresh agent run for `repoPath`. Clears agent-source
      // suggestions only for that repo — enricher and other repos stay put.
      startDiscovery: (repoPath, taskId, taskRunId) => {
        log.info("Discovery started", { repoPath, taskId, taskRunId });
        set((state) => ({
          discoveredTasks: dropAgentTasksForRepo(
            state.discoveredTasks,
            repoPath,
          ),
          discoveryByRepo: updateDiscovery(state, repoPath, {
            status: "running",
            taskId,
            taskRunId,
            feed: EMPTY_FEED,
            error: null,
          }),
        }));
      },

      // Replaces agent-source entries for `repoPath` with the new findings.
      // Other repos' tasks and enricher entries are untouched.
      completeDiscovery: (repoPath, tasks) => {
        log.info("Discovery completed", {
          repoPath,
          taskCount: tasks.length,
        });
        set((state) => {
          const cleaned = dropAgentTasksForRepo(
            state.discoveredTasks,
            repoPath,
          );
          const agent = tasks.map((t) => ({
            ...t,
            source: "agent" as const,
            repoPath: t.repoPath ?? repoPath,
          }));
          return {
            discoveredTasks: [...cleaned, ...agent],
            discoveryByRepo: updateDiscovery(state, repoPath, {
              status: "done",
              error: null,
            }),
          };
        });
      },

      failDiscovery: (repoPath, message) => {
        log.warn("Discovery failed", { repoPath, message });
        set((state) => ({
          discoveryByRepo: updateDiscovery(state, repoPath, {
            status: "error",
            error: message ?? null,
          }),
        }));
      },

      resetDiscovery: (repoPath) => {
        log.info("Discovery reset", { repoPath });
        set((state) => ({
          discoveredTasks: dropAgentTasksForRepo(
            state.discoveredTasks,
            repoPath,
          ),
          discoveryByRepo: updateDiscovery(state, repoPath, {
            status: "idle",
            taskId: null,
            taskRunId: null,
            feed: EMPTY_FEED,
            error: null,
          }),
        }));
      },

      startEnrichment: (repoPath) => {
        set((state) => ({
          enricherByRepo: updateEnricher(state, repoPath, {
            status: "running",
          }),
        }));
      },

      completeEnrichment: (repoPath) => {
        set((state) => ({
          enricherByRepo: updateEnricher(state, repoPath, { status: "done" }),
        }));
      },

      failEnrichment: (repoPath) => {
        set((state) => ({
          enricherByRepo: updateEnricher(state, repoPath, { status: "error" }),
        }));
      },

      removeDiscoveredTask: (taskId, repoPath) => {
        set((state) => ({
          discoveredTasks: state.discoveredTasks.filter(
            (t) => !(t.id === taskId && isTaskForRepo(t, repoPath)),
          ),
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
      // the same id+repoPath. Idempotent — safe to call repeatedly on every
      // detection run. Dismissed suggestions stay dismissed until `resetSetup`.
      addEnricherSuggestionIfMissing: (task) => {
        set((state) => {
          const repoTask = { ...task, source: "enricher" as const };
          if (
            state.discoveredTasks.some(
              (t) => t.id === repoTask.id && t.repoPath === repoTask.repoPath,
            )
          ) {
            return state;
          }
          return {
            discoveredTasks: [repoTask, ...state.discoveredTasks],
          };
        });
      },

      pushDiscoveryActivity: (repoPath, entry) => {
        set((state) => {
          const prev = state.discoveryByRepo[repoPath] ?? DEFAULT_DISCOVERY;
          return {
            discoveryByRepo: updateDiscovery(state, repoPath, {
              feed: pushEntry(prev.feed, entry),
            }),
          };
        });
      },

      resetSetup: () => {
        log.info("Setup state reset");
        set({ ...initialState });
      },
    }),
    {
      name: "setup-store",
      version: 2,
      migrate: (persistedState, version): PersistedSetupState => {
        if (version < 2) {
          // v1 stored a global discoveryStatus; drop it. Tasks persist as-is.
          const state = (persistedState ?? {}) as { discoveredTasks?: unknown };
          return {
            discoveredTasks: Array.isArray(state.discoveredTasks)
              ? (state.discoveredTasks as DiscoveredTask[])
              : [],
            discoveryByRepo: {},
          };
        }
        return persistedState as PersistedSetupState;
      },
      // Persist non-idle discovery status per repo so a known-done repo
      // doesn't trigger another full agent run on reload. Persist "running"
      // as "error" so an interrupted run (crash, force-quit, freeze) doesn't
      // auto-restart on next boot — otherwise discovery loops forever,
      // creating new cloud tasks and spawning agents on every launch.
      partialize: (state): PersistedSetupState => ({
        discoveredTasks: state.discoveredTasks,
        discoveryByRepo: Object.fromEntries(
          Object.entries(state.discoveryByRepo)
            .filter(([, d]) => d.status !== "idle")
            .map(([repo, d]) => {
              if (d.status === "running") {
                return [
                  repo,
                  {
                    ...DEFAULT_DISCOVERY,
                    status: "error",
                    error: "Discovery was interrupted. You can skip or retry.",
                  },
                ];
              }
              return [
                repo,
                { ...DEFAULT_DISCOVERY, status: d.status, error: d.error },
              ];
            }),
        ),
      }),
    },
  ),
);
