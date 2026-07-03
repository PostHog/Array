import { create } from "zustand";

interface StaleConversationGateState {
  /** Sessions where the user accepted the "large + idle = costly" warning. */
  acknowledgedSessions: Set<string>;
}

interface StaleConversationGateActions {
  acknowledge: (sessionId: string) => void;
  isAcknowledged: (sessionId: string) => boolean;
  reset: (sessionId: string) => void;
}

export type StaleConversationGateStore = StaleConversationGateState &
  StaleConversationGateActions;

/**
 * Tracks which sessions have dismissed the stale-costly-conversation cost
 * warning. Ephemeral view state (not persisted): dismissing is per-session and
 * only needs to last for the current app run.
 */
export const useStaleConversationGateStore =
  create<StaleConversationGateStore>()((set, get) => ({
    acknowledgedSessions: new Set(),

    acknowledge: (sessionId) =>
      set((state) => {
        if (state.acknowledgedSessions.has(sessionId)) return state;
        const next = new Set(state.acknowledgedSessions);
        next.add(sessionId);
        return { acknowledgedSessions: next };
      }),

    isAcknowledged: (sessionId) => get().acknowledgedSessions.has(sessionId),

    reset: (sessionId) =>
      set((state) => {
        if (!state.acknowledgedSessions.has(sessionId)) return state;
        const next = new Set(state.acknowledgedSessions);
        next.delete(sessionId);
        return { acknowledgedSessions: next };
      }),
  }));
