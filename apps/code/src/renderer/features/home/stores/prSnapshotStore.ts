import type { PrSnapshot, TaskPrSnapshot } from "@shared/types/pr-snapshot";
import { create } from "zustand";

// Subscription-fed cache of PR/CI snapshots, keyed by task id. Pure UI state
// per R2: the main PrSnapshotService owns resolution and freshness; this store
// just mirrors what it pushes over `prSnapshot.onUpdated` so components
// re-render.
interface PrSnapshotStore {
  byTaskId: Record<string, PrSnapshot>;
  upsertMany: (results: TaskPrSnapshot[]) => void;
}

export const usePrSnapshotStore = create<PrSnapshotStore>((set) => ({
  byTaskId: {},
  upsertMany: (results) =>
    set((state) => {
      if (results.length === 0) return state;
      const byTaskId = { ...state.byTaskId };
      for (const { taskId, snapshot } of results) byTaskId[taskId] = snapshot;
      return { byTaskId };
    }),
}));
