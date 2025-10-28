import type { Task } from "@shared/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyActiveFilters, applyTextSearch } from "../utils/taskFiltering";
import { sortTasks } from "../utils/taskSorting";
import type {
  ActiveFilters,
  FilterCategory,
  FilterMatchMode,
  FilterOperator,
  OrderByField,
  OrderDirection,
  TaskState,
} from "./taskStore.types";

export function filterTasks(
  tasks: Task[],
  orderBy: OrderByField,
  orderDirection: OrderDirection,
  filter: string,
  activeFilters: ActiveFilters = {},
  filterMatchMode: FilterMatchMode = "all",
): Task[] {
  const sorted = sortTasks(tasks, orderBy, orderDirection);
  const filtered = applyActiveFilters(sorted, activeFilters, filterMatchMode);
  return applyTextSearch(filtered, filter);
}

function getDefaultOperator(category: FilterCategory): FilterOperator {
  return category === "created_at" ? "after" : "is";
}

function toggleOperator(
  category: FilterCategory,
  operator: FilterOperator,
): FilterOperator {
  if (category === "created_at") {
    return operator === "before" ? "after" : "before";
  }
  return operator === "is" ? "is_not" : "is";
}

// Re-export types for convenience
export type {
  ActiveFilters,
  FilterCategory,
  FilterMatchMode,
  FilterOperator,
  FilterValue,
  GroupByField,
  OrderByField,
  OrderDirection,
} from "./taskStore.types";

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
      activeFilters: {},
      filterMatchMode: "all",
      filterSearchQuery: "",
      filterMenuSelectedIndex: -1,
      isSearchExpanded: false,
      isFilterDropdownOpen: false,
      editingFilterBadgeKey: null,

      selectTask: (taskId) => set({ selectedTaskId: taskId }),
      setTaskOrder: (order) => set({ taskOrder: order }),

      moveTask: (_taskId, fromIndex, toIndex, allTasks) => {
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

      setDraggedTaskId: (taskId) => set({ draggedTaskId: taskId }),
      setDragOverState: (index, position) =>
        set({ dragOverIndex: index, dropPosition: position }),
      clearDragState: () =>
        set({ draggedTaskId: null, dragOverIndex: null, dropPosition: null }),

      setSelectedIndex: (index) => set({ selectedIndex: index }),
      setHoveredIndex: (index) => set({ hoveredIndex: index }),
      setContextMenuIndex: (index) => set({ contextMenuIndex: index }),

      setFilter: (filter) => set({ filter }),
      setOrderBy: (orderBy) => set({ orderBy }),
      setOrderDirection: (orderDirection) => set({ orderDirection }),
      setGroupBy: (groupBy) => set({ groupBy }),

      toggleGroupExpanded: (groupName) =>
        set((state) => ({
          expandedGroups: {
            ...state.expandedGroups,
            [groupName]: !(state.expandedGroups[groupName] ?? true),
          },
        })),

      setActiveFilters: (filters) => set({ activeFilters: filters }),
      clearActiveFilters: () => set({ activeFilters: {} }),

      toggleFilter: (category, value, operator) =>
        set((state) => {
          const currentFilters = state.activeFilters[category] || [];
          const existingFilter = currentFilters.find((f) => f.value === value);

          if (existingFilter) {
            const newFilters = currentFilters.filter((f) => f.value !== value);
            return {
              activeFilters: {
                ...state.activeFilters,
                [category]: newFilters.length > 0 ? newFilters : undefined,
              },
            };
          }

          return {
            activeFilters: {
              ...state.activeFilters,
              [category]: [
                ...currentFilters,
                { value, operator: operator ?? getDefaultOperator(category) },
              ],
            },
          };
        }),

      addFilter: (category, value, operator) =>
        set((state) => ({
          activeFilters: {
            ...state.activeFilters,
            [category]: [
              ...(state.activeFilters[category] || []),
              { value, operator: operator ?? getDefaultOperator(category) },
            ],
          },
        })),

      toggleFilterOperator: (category, value) =>
        set((state) => {
          const currentFilters = state.activeFilters[category] || [];
          const filterIndex = currentFilters.findIndex(
            (f) => f.value === value,
          );

          if (filterIndex === -1) return state;

          const updatedFilters = [...currentFilters];
          const currentOperator = updatedFilters[filterIndex].operator;

          updatedFilters[filterIndex] = {
            ...updatedFilters[filterIndex],
            operator: toggleOperator(category, currentOperator),
          };

          return {
            activeFilters: {
              ...state.activeFilters,
              [category]: updatedFilters,
            },
          };
        }),

      setFilterMatchMode: (mode) => set({ filterMatchMode: mode }),
      setFilterSearchQuery: (query) => set({ filterSearchQuery: query }),
      setFilterMenuSelectedIndex: (index) =>
        set({ filterMenuSelectedIndex: index }),
      setIsSearchExpanded: (expanded) => set({ isSearchExpanded: expanded }),
      setIsFilterDropdownOpen: (open) => set({ isFilterDropdownOpen: open }),
      setEditingFilterBadgeKey: (key) => set({ editingFilterBadgeKey: key }),
    }),
    {
      name: "task-store",
      partialize: (state) => ({
        taskOrder: state.taskOrder,
        orderBy: state.orderBy,
        orderDirection: state.orderDirection,
        groupBy: state.groupBy,
        expandedGroups: state.expandedGroups,
        activeFilters: state.activeFilters,
        filterMatchMode: state.filterMatchMode,
      }),
    },
  ),
);
