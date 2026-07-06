import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type AdapterType = "claude" | "codex";

interface SessionAdapterState {
  adaptersByRunId: Record<string, AdapterType>;
  // Codex sub-adapter pinned at session creation: true = app-server, null =
  // resolved undefined (codex-acp / env fallback). Keeps a resumed session on
  // the sub-adapter that created its thread even if the rollout flag flips.
  codexAppServerByRunId: Record<string, boolean | null>;
  setAdapter: (taskRunId: string, adapter: AdapterType) => void;
  getAdapter: (taskRunId: string) => AdapterType | undefined;
  setUseCodexAppServer: (
    taskRunId: string,
    useAppServer: boolean | null,
  ) => void;
  getUseCodexAppServer: (taskRunId: string) => boolean | null | undefined;
  removeAdapter: (taskRunId: string) => void;
}

export const useSessionAdapterStore = create<SessionAdapterState>()(
  persist(
    (set, get) => ({
      adaptersByRunId: {},
      codexAppServerByRunId: {},
      setAdapter: (taskRunId, adapter) =>
        set((state) => ({
          adaptersByRunId: { ...state.adaptersByRunId, [taskRunId]: adapter },
        })),
      getAdapter: (taskRunId) => get().adaptersByRunId[taskRunId],
      setUseCodexAppServer: (taskRunId, useAppServer) =>
        set((state) => ({
          codexAppServerByRunId: {
            ...state.codexAppServerByRunId,
            [taskRunId]: useAppServer,
          },
        })),
      getUseCodexAppServer: (taskRunId) =>
        get().codexAppServerByRunId[taskRunId],
      removeAdapter: (taskRunId) =>
        set((state) => {
          const { [taskRunId]: _removed, ...rest } = state.adaptersByRunId;
          const { [taskRunId]: _removedPin, ...restPins } =
            state.codexAppServerByRunId;
          return { adaptersByRunId: rest, codexAppServerByRunId: restPins };
        }),
    }),
    {
      name: "session-adapter-storage",
      storage: electronStorage,
      partialize: (state) => ({
        adaptersByRunId: state.adaptersByRunId,
        codexAppServerByRunId: state.codexAppServerByRunId,
      }),
    },
  ),
);
