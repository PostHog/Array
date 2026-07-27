import { create } from "zustand";

interface TrackedTaskCompletion {
  taskId: string;
  title: string;
  trackedAt: number;
}

interface TaskCompletionTrackerState {
  tracked: Record<string, TrackedTaskCompletion>;
  track: (task: Omit<TrackedTaskCompletion, "trackedAt">) => void;
  untrack: (taskId: string) => void;
}

export const useTaskCompletionTrackerStore = create<TaskCompletionTrackerState>(
  (set) => ({
    tracked: {},
    track: (task) =>
      set((state) => ({
        tracked: {
          ...state.tracked,
          [task.taskId]: { ...task, trackedAt: Date.now() },
        },
      })),
    untrack: (taskId) =>
      set((state) => {
        if (!state.tracked[taskId]) return state;
        const { [taskId]: _removed, ...tracked } = state.tracked;
        return { tracked };
      }),
  }),
);
