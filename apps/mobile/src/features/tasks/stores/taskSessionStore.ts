import type {
  CloudTaskSession,
  CloudTaskSessionStatePort,
} from "@posthog/core/sessions/cloudTaskSessionService";
import { create } from "zustand";

interface TaskSessionState {
  sessions: Record<string, CloudTaskSession>;
  focusedTaskId: string | null;
  setFocusedTaskId(taskId: string | null): void;
}

export const useTaskSessionStore = create<TaskSessionState>((set) => ({
  sessions: {},
  focusedTaskId: null,
  setFocusedTaskId: (focusedTaskId) => set({ focusedTaskId }),
}));

export const taskSessionStatePort: CloudTaskSessionStatePort = {
  getByTaskId: (taskId) =>
    Object.values(useTaskSessionStore.getState().sessions).find(
      (session) => session.taskId === taskId,
    ),
  getByRunId: (runId) => useTaskSessionStore.getState().sessions[runId],
  set: (session) =>
    useTaskSessionStore.setState((state) => ({
      sessions: { ...state.sessions, [session.taskRunId]: session },
    })),
  update: (runId, updater) =>
    useTaskSessionStore.setState((state) => {
      const session = state.sessions[runId];
      if (!session) return state;
      return {
        sessions: { ...state.sessions, [runId]: updater(session) },
      };
    }),
  remove: (runId) =>
    useTaskSessionStore.setState((state) => {
      if (!(runId in state.sessions)) return state;
      const { [runId]: _removed, ...sessions } = state.sessions;
      return { sessions };
    }),
};

export function getTaskSession(taskId: string): CloudTaskSession | undefined {
  return taskSessionStatePort.getByTaskId(taskId);
}
