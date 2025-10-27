import type { Task } from "@shared/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OrderByField =
  | "created_at"
  | "status"
  | "title"
  | "repository"
  | "working_directory"
  | "source";
export type OrderDirection = "asc" | "desc";
export type GroupByField =
  | "none"
  | "status"
  | "creator"
  | "source"
  | "repository";

interface TaskState {
  taskOrder: Record<string, number>;
  selectedTaskId: string | null;
  draggedTaskId: string | null;
  dragOverIndex: number | null;
  dropPosition: "top" | "bottom" | null;
  selectedIndex: number | null;
  hoveredIndex: number | null;
  contextMenuIndex: number | null;
  filter: string;
  orderBy: OrderByField;
  orderDirection: OrderDirection;
  groupBy: GroupByField;
  expandedGroups: Record<string, boolean>;

  selectTask: (taskId: string | null) => void;
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
  setOrderBy: (orderBy: OrderByField) => void;
  setOrderDirection: (orderDirection: OrderDirection) => void;
  setGroupBy: (groupBy: GroupByField) => void;
  toggleGroupExpanded: (groupName: string) => void;
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set) => ({
      taskOrder: {},
      selectedTaskId: null,
      draggedTaskId: null,
      dragOverIndex: null,
      dropPosition: null,
      selectedIndex: null,
      hoveredIndex: null,
      contextMenuIndex: null,
      filter: "",
      orderBy: "created_at",
      orderDirection: "desc",
      groupBy: "none",
      expandedGroups: {},

      selectTask: (taskId: string | null) => {
        set({ selectedTaskId: taskId });
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

      setOrderBy: (orderBy: OrderByField) => {
        set({ orderBy });
      },

      setOrderDirection: (orderDirection: OrderDirection) => {
        set({ orderDirection });
      },

      setGroupBy: (groupBy: GroupByField) => {
        set({ groupBy });
      },

      toggleGroupExpanded: (groupName: string) => {
        set((state) => ({
          expandedGroups: {
            ...state.expandedGroups,
            [groupName]: !(state.expandedGroups[groupName] ?? true),
          },
        }));
      },
    }),
    {
      name: "task-store",
      partialize: (state) => ({
        taskOrder: state.taskOrder,
        orderBy: state.orderBy,
        orderDirection: state.orderDirection,
        groupBy: state.groupBy,
        expandedGroups: state.expandedGroups,
      }),
    },
  ),
);
