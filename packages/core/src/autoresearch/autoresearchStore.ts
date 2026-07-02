import { createStore } from "zustand/vanilla";
import {
  type AutoresearchEndReason,
  type AutoresearchIteration,
  type AutoresearchRun,
  type AutoresearchRunStatus,
  isTerminalRunStatus,
} from "./schemas";

export interface AutoresearchState {
  /** Runs indexed by run id. */
  runs: Record<string, AutoresearchRun>;
  /** taskId -> id of the most recently started run for that task. */
  activeRunIdByTask: Record<string, string>;
}

export const autoresearchStore = createStore<AutoresearchState>(() => ({
  runs: {},
  activeRunIdByTask: {},
}));

function updateRun(
  runId: string,
  update: (run: AutoresearchRun) => AutoresearchRun,
): void {
  autoresearchStore.setState((state) => {
    const run = state.runs[runId];
    if (!run) return state;
    return { runs: { ...state.runs, [runId]: update(run) } };
  });
}

export const autoresearchStoreActions = {
  upsertRun(run: AutoresearchRun): void {
    autoresearchStore.setState((state) => ({
      runs: { ...state.runs, [run.id]: run },
      activeRunIdByTask: {
        ...state.activeRunIdByTask,
        [run.config.taskId]: run.id,
      },
    }));
  },

  appendIteration(runId: string, iteration: AutoresearchIteration): void {
    updateRun(runId, (run) => ({
      ...run,
      iterations: [...run.iterations, iteration],
    }));
  },

  setRunStatus(
    runId: string,
    status: AutoresearchRunStatus,
    options?: { endReason?: AutoresearchEndReason; lastError?: string },
  ): void {
    const terminal = isTerminalRunStatus(status);
    updateRun(runId, (run) => ({
      ...run,
      status,
      endedAt: terminal ? Date.now() : run.endedAt,
      endReason: options?.endReason ?? (terminal ? run.endReason : null),
      lastError: options?.lastError ?? run.lastError,
    }));
  },

  reset(): void {
    autoresearchStore.setState({ runs: {}, activeRunIdByTask: {} });
  },
};

export function getActiveRunForTask(
  state: AutoresearchState,
  taskId: string,
): AutoresearchRun | null {
  const runId = state.activeRunIdByTask[taskId];
  return runId ? (state.runs[runId] ?? null) : null;
}
