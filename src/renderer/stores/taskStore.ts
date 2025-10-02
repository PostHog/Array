import type { Task } from "@shared/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAuthStore } from "./authStore";

interface TaskState {
  tasks: Task[];
  taskOrder: Record<string, number>;
  selectedTaskId: string | null;
  isLoading: boolean;
  error: string | null;
  draggedTaskId: string | null;
  dragOverIndex: number | null;
  dropPosition: "top" | "bottom" | null;
  selectedIndex: number | null;
  hoveredIndex: number | null;
  contextMenuIndex: number | null;
  filter: string;

  fetchTasks: () => Promise<void>;
  selectTask: (taskId: string | null) => void;
  refreshTask: (taskId: string) => Promise<void>;
  createTask: (
    title: string,
    description: string,
    repositoryConfig?: { organization: string; repository: string },
  ) => Promise<Task | null>;
  deleteTask: (taskId: string) => Promise<void>;
  duplicateTask: (taskId: string) => Promise<Task | null>;
  updateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
  setTaskOrder: (order: Record<string, number>) => void;
  moveTask: (
    taskId: string,
    fromIndex: number,
    toIndex: number,
    allTasks: Task[],
  ) => void;
  setDraggedTaskId: (taskId: string | null) => void;
  setDragOverState: (
    index: number | null,
    position: "top" | "bottom" | null,
  ) => void;
  clearDragState: () => void;
  setSelectedIndex: (index: number | null) => void;
  setHoveredIndex: (index: number | null) => void;
  setContextMenuIndex: (index: number | null) => void;
  setFilter: (filter: string) => void;
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      tasks: [],
      taskOrder: {},
      selectedTaskId: null,
      isLoading: false,
      error: null,
      draggedTaskId: null,
      dragOverIndex: null,
      dropPosition: null,
      selectedIndex: null,
      hoveredIndex: null,
      contextMenuIndex: null,
      filter: "",

      fetchTasks: async () => {
        const client = useAuthStore.getState().client;
        if (!client) return;

        set({ isLoading: true, error: null });

        try {
          const tasks = await client.getTasks();
          set({ tasks: tasks as Task[], isLoading: false });
        } catch (error) {
          set({
            error:
              error instanceof Error ? error.message : "Failed to fetch tasks",
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
            task.id === taskId ? (updatedTask as Task) : task,
          );
          set({ tasks });
        } catch (error) {
          console.error("Failed to refresh task:", error);
        }
      },

      createTask: async (
        title: string,
        description: string,
        repositoryConfig?: { organization: string; repository: string },
      ) => {
        const client = useAuthStore.getState().client;
        if (!client) return null;

        set({ isLoading: true, error: null });

        try {
          const newTask = await client.createTask(
            title,
            description,
            repositoryConfig,
          );
          const tasks = [newTask as Task, ...get().tasks];
          set({ tasks, isLoading: false });
          return newTask as Task;
        } catch (error) {
          set({
            error:
              error instanceof Error ? error.message : "Failed to create task",
            isLoading: false,
          });
          return null;
        }
      },

      deleteTask: async (taskId: string) => {
        const client = useAuthStore.getState().client;
        if (!client) return;

        try {
          await client.deleteTask(taskId);
          const tasks = get().tasks.filter((task) => task.id !== taskId);
          set({ tasks });
        } catch (error) {
          console.error("Failed to delete task:", error);
        }
      },

      duplicateTask: async (taskId: string) => {
        const client = useAuthStore.getState().client;
        if (!client) return null;

        set({ isLoading: true, error: null });

        try {
          const duplicatedTask = await client.duplicateTask(taskId);
          const tasks = [duplicatedTask as Task, ...get().tasks];
          set({ tasks, isLoading: false });
          return duplicatedTask as Task;
        } catch (error) {
          set({
            error:
              error instanceof Error
                ? error.message
                : "Failed to duplicate task",
            isLoading: false,
          });
          return null;
        }
      },

      updateTask: async (taskId: string, updates: Partial<Task>) => {
        const client = useAuthStore.getState().client;
        if (!client) return;

        try {
          await client.updateTask(
            taskId,
            updates as Parameters<typeof client.updateTask>[1],
          );
          const tasks = get().tasks.map((task) =>
            task.id === taskId ? { ...task, ...updates } : task,
          );
          set({ tasks });
        } catch (error) {
          console.error("Failed to update task:", error);
        }
      },

      setTaskOrder: (order: Record<string, number>) => {
        set({ taskOrder: order });
      },

      moveTask: (
        _taskId: string,
        fromIndex: number,
        toIndex: number,
        allTasks: Task[],
      ) => {
        const newOrder = [...allTasks];
        const [movedTask] = newOrder.splice(fromIndex, 1);
        newOrder.splice(toIndex, 0, movedTask);

        const orderMap = newOrder.reduce(
          (acc, task, index) => {
            acc[task.id] = index;
            return acc;
          },
          {} as Record<string, number>,
        );
        set({ taskOrder: orderMap });
      },

      setDraggedTaskId: (taskId: string | null) => {
        set({ draggedTaskId: taskId });
      },

      setDragOverState: (
        index: number | null,
        position: "top" | "bottom" | null,
      ) => {
        set({ dragOverIndex: index, dropPosition: position });
      },

      clearDragState: () => {
        set({ draggedTaskId: null, dragOverIndex: null, dropPosition: null });
      },

      setSelectedIndex: (index: number | null) => {
        set({ selectedIndex: index });
      },

      setHoveredIndex: (index: number | null) => {
        set({ hoveredIndex: index });
      },

      setContextMenuIndex: (index: number | null) => {
        set({ contextMenuIndex: index });
      },

      setFilter: (filter: string) => {
        set({ filter });
      },
    }),
    {
      name: "task-store",
      partialize: (state) => ({ taskOrder: state.taskOrder }),
    },
  ),
);
