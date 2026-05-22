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
  "queued",
  "completed",
  "backlog",
];

export interface TaskState {
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
  isFilterDropdownOpen: boolean;
  editingFilterBadgeKey: string | null;

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
  setIsFilterDropdownOpen: (open: boolean) => void;
  setEditingFilterBadgeKey: (key: string | null) => void;
}
