import { create } from "zustand";
import { persist } from "zustand/middleware";

interface RevisitStoreState {
  revisitTaskIds: Set<string>;
}

interface RevisitStoreActions {
  isRevisit: (taskId: string) => boolean;
  setRevisit: (taskId: string, on: boolean) => void;
  toggle: (taskId: string) => void;
}

type RevisitStore = RevisitStoreState & RevisitStoreActions;

export const useRevisitStore = create<RevisitStore>()(
  persist(
    (set, get) => ({
      revisitTaskIds: new Set<string>(),
      isRevisit: (taskId) => get().revisitTaskIds.has(taskId),
      setRevisit: (taskId, on) =>
        set((state) => {
          const next = new Set(state.revisitTaskIds);
          if (on) {
            next.add(taskId);
          } else {
            next.delete(taskId);
          }
          return { revisitTaskIds: next };
        }),
      toggle: (taskId) =>
        set((state) => {
          const next = new Set(state.revisitTaskIds);
          if (next.has(taskId)) {
            next.delete(taskId);
          } else {
            next.add(taskId);
          }
          return { revisitTaskIds: next };
        }),
    }),
    {
      name: "revisit-tasks-storage",
      partialize: (state) => ({
        revisitTaskIds: Array.from(state.revisitTaskIds),
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as { revisitTaskIds?: string[] };
        return {
          ...current,
          revisitTaskIds: new Set(persistedState.revisitTaskIds ?? []),
        };
      },
    },
  ),
);
