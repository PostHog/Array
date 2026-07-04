import { create } from "zustand";

interface StaleConversationGateState {
  /** Sessions where the user accepted the "large + idle = costly" warning. */
  acknowledgedSessions: Set<string>;
}

interface StaleConversationGateActions {
  acknowledge: (sessionId: string) => void;
}

export type StaleConversationGateStore = StaleConversationGateState &
  StaleConversationGateActions;

/**
 * Tracks which sessions have accepted the stale-costly-conversation cost
 * warning. Ephemeral view state (not persisted): acknowledgement is per-session
 * and only needs to last for the current app run. Read via the reactive
 * `acknowledgedSessions.has(id)` selector.
 */
export const useStaleConversationGateStore =
  create<StaleConversationGateStore>()((set) => ({
    acknowledgedSessions: new Set(),

    acknowledge: (sessionId) =>
      set((state) => {
        if (state.acknowledgedSessions.has(sessionId)) return state;
        const next = new Set(state.acknowledgedSessions);
        next.add(sessionId);
        return { acknowledgedSessions: next };
      }),
  }));
