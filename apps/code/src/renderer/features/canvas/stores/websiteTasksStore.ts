import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WebsiteTasksState {
  /** Task IDs created within the Website space, most-recent first. */
  taskIds: string[];
  addTask: (taskId: string) => void;
  removeTask: (taskId: string) => void;
}

// Tracks which tasks were created from the Website space so they can be listed
// in the Website sub-nav and reopened at /website/tasks/$taskId. There is no
// backend "folder" binding yet — membership lives here, persisted locally.
export const useWebsiteTasksStore = create<WebsiteTasksState>()(
  persist(
    (set) => ({
      taskIds: [],
      addTask: (taskId) =>
        set((state) => ({
          taskIds: [taskId, ...state.taskIds.filter((id) => id !== taskId)],
        })),
      removeTask: (taskId) =>
        set((state) => ({
          taskIds: state.taskIds.filter((id) => id !== taskId),
        })),
    }),
    { name: "code:website-tasks" },
  ),
);
