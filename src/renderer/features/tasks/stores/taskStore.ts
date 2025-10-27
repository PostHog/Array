import { getUserDisplayName } from "@hooks/useUsers";
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

// Helper to get computed status
function getTaskStatus(task: Task): string {
  const hasPR = task.latest_run?.output?.pr_url;
  return hasPR ? "completed" : task.latest_run?.status || "backlog";
}

/**
 * Filter and sort tasks based on current filter and order settings
 */
export function filterTasks(
  tasks: Task[],
  orderBy: OrderByField,
  orderDirection: OrderDirection,
  filter: string,
): Task[] {
  // Status order for sorting
  const statusOrder = [
    "failed",
    "in_progress",
    "started",
    "completed",
    "backlog",
  ];

  // Sort tasks
  const orderedTasks = [...tasks].sort((a, b) => {
    let compareResult = 0;

    switch (orderBy) {
      case "created_at":
        compareResult =
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
      case "status": {
        const statusA = getTaskStatus(a);
        const statusB = getTaskStatus(b);
        const indexA = statusOrder.indexOf(statusA);
        const indexB = statusOrder.indexOf(statusB);

        // Use index-based comparison if both found, otherwise alphabetical
        if (indexA !== -1 && indexB !== -1) {
          compareResult = indexA - indexB;
        } else if (indexA !== -1) {
          compareResult = -1;
        } else if (indexB !== -1) {
          compareResult = 1;
        } else {
          compareResult = statusA.localeCompare(statusB);
        }
        break;
      }
      case "title":
        compareResult = a.title.localeCompare(b.title);
        break;
      case "repository": {
        const repoA = a.repository_config
          ? `${a.repository_config.organization}/${a.repository_config.repository}`
          : "";
        const repoB = b.repository_config
          ? `${b.repository_config.organization}/${b.repository_config.repository}`
          : "";
        compareResult = repoA.localeCompare(repoB);
        break;
      }
      case "working_directory":
        compareResult = 0;
        break;
      case "source":
        compareResult = a.origin_product.localeCompare(b.origin_product);
        break;
      default:
        compareResult = 0;
    }

    return orderDirection === "asc" ? compareResult : -compareResult;
  });

  // Filter tasks
  return orderedTasks.filter(
    (task) =>
      task.title.toLowerCase().includes(filter.toLowerCase()) ||
      task.description?.toLowerCase().includes(filter.toLowerCase()),
  );
}

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

export interface TaskGroup {
  name: string;
  tasks: Task[];
}

export interface TaskGroupingResult {
  groups: TaskGroup[];
  taskToGlobalIndex: Map<string, number>;
}

export function getTaskGrouping(
  filteredTasks: Task[],
  groupBy: GroupByField,
): TaskGroupingResult | null {
  if (groupBy === "none") {
    return null;
  }

  const getGroupKey = (task: Task): string => {
    switch (groupBy) {
      case "status": {
        const hasPR = task.latest_run?.output?.pr_url;
        return hasPR ? "completed" : task.latest_run?.status || "Backlog";
      }
      case "creator": {
        if (!task.created_by) return "No Creator";
        return getUserDisplayName(task.created_by);
      }
      case "source":
        return task.origin_product;
      case "repository":
        return task.repository_config?.organization &&
          task.repository_config?.repository
          ? `${task.repository_config.organization}/${task.repository_config.repository}`
          : "No Repository Connected";
      default:
        return "All Tasks";
    }
  };

  const groups = new Map<string, Task[]>();
  const taskToGlobalIndex = new Map<string, number>();

  filteredTasks.forEach((task, index) => {
    taskToGlobalIndex.set(task.id, index);
  });

  for (const task of filteredTasks) {
    const key = getGroupKey(task);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)?.push(task);
  }

  const statusOrder = [
    "failed",
    "in_progress",
    "started",
    "completed",
    "Backlog",
  ];

  const sortedGroups = Array.from(groups.entries())
    .map(([name, tasks]) => ({
      name,
      tasks,
    }))
    .sort((a, b) => {
      if (groupBy === "status") {
        const aIndex = statusOrder.indexOf(a.name);
        const bIndex = statusOrder.indexOf(b.name);

        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
      }

      const aIsEmpty = a.name.startsWith("No ");
      const bIsEmpty = b.name.startsWith("No ");

      if (aIsEmpty && !bIsEmpty) return 1;
      if (!aIsEmpty && bIsEmpty) return -1;

      return a.name.localeCompare(b.name);
    });

  return {
    groups: sortedGroups,
    taskToGlobalIndex,
  };
}
