import { create } from "zustand";

// Tracks which workstreams have a quick action in flight, keyed by workstream id.
// Shared across every surface that can start an action (the list/board row and the
// detail panel mount independent `useRunWorkstreamAction` hooks), so the guard and
// the disabled state are consistent across all of them — a per-hook ref would let
// the row and the open detail panel each start a task for the same workstream.
interface QuickActionStore {
  inFlight: Record<string, boolean>;
  start: (workstreamId: string) => void;
  finish: (workstreamId: string) => void;
}

export const useQuickActionStore = create<QuickActionStore>((set) => ({
  inFlight: {},
  start: (workstreamId) =>
    set((s) => ({ inFlight: { ...s.inFlight, [workstreamId]: true } })),
  finish: (workstreamId) =>
    set((s) => {
      const next = { ...s.inFlight };
      delete next[workstreamId];
      return { inFlight: next };
    }),
}));
