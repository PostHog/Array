import { create } from "zustand";

interface StaleConversationGateState {
  /**
   * Sessions where the gate engaged, keyed to the last-activity time observed
   * at that moment (null when no activity was observed). Latched because
   * reconnecting to a stale session immediately appends freshly-stamped
   * events (usage updates, handshakes) that would otherwise make the
   * conversation look active again and dismiss the warning before the user
   * has chosen.
   */
  engagedSessions: Map<string, number | null>;
  /** Sessions where the user accepted the "large + idle = costly" warning. */
  acknowledgedSessions: Set<string>;
}

interface StaleConversationGateActions {
  engage: (sessionId: string, lastActivityAt: number | null) => void;
  acknowledge: (sessionId: string) => void;
}

export type StaleConversationGateStore = StaleConversationGateState &
  StaleConversationGateActions;

/**
 * Tracks which sessions have engaged and which have accepted the
 * stale-costly-conversation cost warning. Ephemeral view state (not
 * persisted): both only need to last for the current app run.
 */
export const useStaleConversationGateStore =
  create<StaleConversationGateStore>()((set) => ({
    engagedSessions: new Map(),
    acknowledgedSessions: new Set(),

    engage: (sessionId, lastActivityAt) =>
      set((state) => {
        if (
          state.engagedSessions.has(sessionId) ||
          state.acknowledgedSessions.has(sessionId)
        ) {
          return state;
        }
        const next = new Map(state.engagedSessions);
        next.set(sessionId, lastActivityAt);
        return { engagedSessions: next };
      }),

    acknowledge: (sessionId) =>
      set((state) => {
        if (state.acknowledgedSessions.has(sessionId)) return state;
        const nextAcknowledged = new Set(state.acknowledgedSessions);
        nextAcknowledged.add(sessionId);
        if (!state.engagedSessions.has(sessionId)) {
          return { acknowledgedSessions: nextAcknowledged };
        }
        const nextEngaged = new Map(state.engagedSessions);
        nextEngaged.delete(sessionId);
        return {
          acknowledgedSessions: nextAcknowledged,
          engagedSessions: nextEngaged,
        };
      }),
  }));
