import type { Task } from "@shared/types";
import { create } from "zustand";
import { useAuthStore } from "./authStore";

interface TaskState {
  tasks: Task[];
  selectedTaskId: string | null;
  isLoading: boolean;
  error: string | null;

  fetchTasks: () => Promise<void>;
  selectTask: (taskId: string | null) => void;
  refreshTask: (taskId: string) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  isLoading: false,
  error: null,

  fetchTasks: async () => {
    const client = useAuthStore.getState().client;
    if (!client) return;

    set({ isLoading: true, error: null });

    try {
      const tasks = await client.getTasks();
      set({ tasks, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to fetch tasks",
        isLoading: false,
      });
    }
  },

  selectTask: (taskId: string | null) => {
    set({ selectedTaskId: taskId });
  },

  refreshTask: async (taskId: string) => {
    const client = useAuthStore.getState().client;
    if (!client) return;

    try {
      const updatedTask = await client.getTask(taskId);
      const tasks = get().tasks.map((task) =>
        task.id === taskId ? updatedTask : task,
      );
      set({ tasks });
    } catch (error) {
      console.error("Failed to refresh task:", error);
    }
  },
}));
