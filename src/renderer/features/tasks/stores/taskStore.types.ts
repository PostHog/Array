import type { Task } from "@shared/types";

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

export type FilterCategory =
  | "status"
  | "source"
  | "creator"
  | "repository"
  | "created_at";

export type FilterOperator = "is" | "is_not" | "before" | "after";

export interface FilterValue {
  value: string;
  operator: FilterOperator;
}

export type ActiveFilters = Partial<Record<FilterCategory, FilterValue[]>>;

export type FilterMatchMode = "all" | "any";

export const TASK_STATUS_ORDER: string[] = [
  "failed",
  "in_progress",
  "started",
  "completed",
  "backlog",
];

export interface TaskGroup {
  name: string;
  tasks: Task[];
}

export interface TaskGroupingResult {
  groups: TaskGroup[];
  taskToGlobalIndex: Map<string, number>;
}

export interface TaskState {
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
  activeFilters: ActiveFilters;
  filterMatchMode: FilterMatchMode;
  filterSearchQuery: string;
  filterMenuSelectedIndex: number;
  isSearchExpanded: boolean;
  isFilterDropdownOpen: boolean;
  editingFilterBadgeKey: string | null;

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
  setActiveFilters: (filters: ActiveFilters) => void;
  clearActiveFilters: () => void;
  toggleFilter: (
    category: FilterCategory,
    value: string,
    operator?: FilterOperator,
  ) => void;
  addFilter: (
    category: FilterCategory,
    value: string,
    operator?: FilterOperator,
  ) => void;
  updateFilter: (
    category: FilterCategory,
    oldValue: string,
    newValue: string,
  ) => void;
  toggleFilterOperator: (category: FilterCategory, value: string) => void;
  setFilterMatchMode: (mode: FilterMatchMode) => void;
  setFilterSearchQuery: (query: string) => void;
  setFilterMenuSelectedIndex: (index: number) => void;
  setIsSearchExpanded: (expanded: boolean) => void;
  setIsFilterDropdownOpen: (open: boolean) => void;
  setEditingFilterBadgeKey: (key: string | null) => void;
}
