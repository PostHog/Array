import { trpcClient } from "@renderer/trpc/client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { terminalManager } from "../services/TerminalManager";

interface TerminalState {
  serializedState: string | null;
  sessionId: string | null;
  processName: string | null;
}

interface TerminalStoreState {
  terminalStates: Record<string, TerminalState>;
  pollingIntervals: Record<string, number>;
  getTerminalState: (key: string) => TerminalState | undefined;
  setSerializedState: (key: string, state: string) => void;
  setSessionId: (key: string, sessionId: string) => void;
  setProcessName: (key: string, processName: string | null) => void;
  clearTerminalState: (key: string) => void;
  clearTerminalStatesForTask: (taskId: string) => void;
  startPolling: (key: string) => void;
  stopPolling: (key: string) => void;
}

type PersistedTerminalStoreState = {
  terminalStates: Record<
    string,
    {
      serializedState: string | null;
      sessionId: null;
    }
  >;
};

const DEFAULT_TERMINAL_STATE: TerminalState = {
  serializedState: null,
  sessionId: null,
  processName: null,
};

export function clearPersistedSessionIds(persistedState: unknown) {
  if (!persistedState || typeof persistedState !== "object") {
    return persistedState;
  }

  const state = persistedState as {
    terminalStates?: Record<string, Partial<TerminalState>>;
  };

  if (!state.terminalStates || typeof state.terminalStates !== "object") {
    return persistedState;
  }

  return {
    ...state,
    terminalStates: Object.fromEntries(
      Object.entries(state.terminalStates).map(([key, value]) => [
        key,
        {
          ...value,
          sessionId: null,
        },
      ]),
    ),
  };
}

export const useTerminalStore = create<TerminalStoreState>()(
  persist(
    (set, get) => ({
      terminalStates: {},
      pollingIntervals: {},

      getTerminalState: (key: string) => {
        return get().terminalStates[key] || DEFAULT_TERMINAL_STATE;
      },

      setSerializedState: (key: string, state: string) => {
        set((prev) => ({
          terminalStates: {
            ...prev.terminalStates,
            [key]: {
              ...prev.terminalStates[key],
              serializedState: state,
            },
          },
        }));
      },

      setSessionId: (key: string, sessionId: string) => {
        set((prev) => ({
          terminalStates: {
            ...prev.terminalStates,
            [key]: {
              ...prev.terminalStates[key],
              sessionId,
            },
          },
        }));
      },

      setProcessName: (key: string, processName: string | null) => {
        set((prev) => ({
          terminalStates: {
            ...prev.terminalStates,
            [key]: {
              ...prev.terminalStates[key],
              processName,
            },
          },
        }));
      },

      clearTerminalState: (key: string) => {
        set((prev) => {
          const newStates = { ...prev.terminalStates };
          delete newStates[key];
          return { terminalStates: newStates };
        });
      },

      clearTerminalStatesForTask: (taskId: string) => {
        set((prev) => {
          const newStates = { ...prev.terminalStates };
          for (const key of Object.keys(newStates)) {
            if (key === taskId || key.startsWith(`${taskId}-`)) {
              delete newStates[key];
            }
          }
          return { terminalStates: newStates };
        });
      },

      startPolling: (key: string) => {
        const { pollingIntervals } = get();
        if (pollingIntervals[key]) return;

        const poll = async () => {
          const state = get().terminalStates[key];
          if (!state?.sessionId) return;

          const processName = await trpcClient.shell.getProcess.query({
            sessionId: state.sessionId,
          });
          if (processName !== state.processName) {
            get().setProcessName(key, processName ?? null);
          }
        };

        poll();
        const interval = window.setInterval(poll, 500);
        set((prev) => ({
          pollingIntervals: { ...prev.pollingIntervals, [key]: interval },
        }));
      },

      stopPolling: (key: string) => {
        const { pollingIntervals } = get();
        const interval = pollingIntervals[key];
        if (interval) {
          clearInterval(interval);
          set((prev) => {
            const newIntervals = { ...prev.pollingIntervals };
            delete newIntervals[key];
            return { pollingIntervals: newIntervals };
          });
        }
      },
    }),
    {
      name: "terminal-store",
      version: 1,
      migrate: (persistedState) =>
        clearPersistedSessionIds(persistedState) as PersistedTerminalStoreState,
      partialize: (state): PersistedTerminalStoreState => ({
        terminalStates: Object.fromEntries(
          Object.entries(state.terminalStates).map(([k, v]) => [
            k,
            { serializedState: v.serializedState, sessionId: null },
          ]),
        ),
      }),
    },
  ),
);

// Subscribe to manager events for auto-persistence
terminalManager.on("stateChange", ({ persistenceKey, serializedState }) => {
  useTerminalStore
    .getState()
    .setSerializedState(persistenceKey, serializedState);
});
