import { getUserDisplayName } from "@hooks/useUsers";
import type { Task } from "@shared/types";
import type {
  ActiveFilters,
  FilterCategory,
  FilterMatchMode,
  FilterValue,
} from "../stores/taskStore.types";
import { getTaskStatus } from "./taskSorting";

function applyOperator(
  isMatch: boolean,
  operator: "is" | "is_not" | "before" | "after",
): boolean {
  return operator === "is" || operator === "after" ? isMatch : !isMatch;
}

function getTaskValue(task: Task, category: FilterCategory): string {
  switch (category) {
    case "status":
      return getTaskStatus(task);
    case "source":
      return task.origin_product;
    case "creator":
      return task.created_by
        ? getUserDisplayName(task.created_by)
        : "No Creator";
    case "repository":
      return task.repository_config?.organization &&
        task.repository_config?.repository
        ? `${task.repository_config.organization}/${task.repository_config.repository}`
        : "No Repository Connected";
    case "created_at":
      return task.created_at;
  }
}

function matchesCreatedAtFilter(task: Task, filter: FilterValue): boolean {
  const createdAt = new Date(task.created_at);
  const now = new Date();
  const daysSinceCreated = Math.floor(
    (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
  );

  const dayThresholds: Record<string, number> = {
    Today: 0,
    "Last 7 days": 7,
    "Last 30 days": 30,
    "Last 90 days": 90,
    Older: 90,
  };

  const dayThreshold = dayThresholds[filter.value] ?? 0;
  const isMatch = daysSinceCreated <= dayThreshold;

  return applyOperator(isMatch, filter.operator);
}

function matchesCategoryFilter(
  task: Task,
  category: FilterCategory,
  filters: FilterValue[],
): boolean {
  return filters.some((filter) => {
    if (category === "created_at") {
      return matchesCreatedAtFilter(task, filter);
    }

    const taskValue = getTaskValue(task, category);
    const isMatch = filter.value === taskValue;
    return applyOperator(isMatch, filter.operator);
  });
}

type FilterMatcher = (task: Task) => boolean;

function createCategoryMatchers(activeFilters: ActiveFilters): FilterMatcher[] {
  const matchers: FilterMatcher[] = [];

  (Object.entries(activeFilters) as [FilterCategory, FilterValue[]][]).forEach(
    ([category, filters]) => {
      if (filters?.length) {
        matchers.push((task) => matchesCategoryFilter(task, category, filters));
      }
    },
  );

  return matchers;
}

export function applyActiveFilters(
  tasks: Task[],
  activeFilters: ActiveFilters,
  filterMatchMode: FilterMatchMode = "all",
): Task[] {
  const matchers = createCategoryMatchers(activeFilters);

  if (matchers.length === 0) return tasks;

  return tasks.filter((task) => {
    const results = matchers.map((matcher) => matcher(task));
    return filterMatchMode === "any"
      ? results.some(Boolean)
      : results.every(Boolean);
  });
}

export function applyTextSearch(tasks: Task[], searchQuery: string): Task[] {
  if (!searchQuery) return tasks;

  const query = searchQuery.toLowerCase();
  return tasks.filter(
    (task) =>
      task.title.toLowerCase().includes(query) ||
      task.description?.toLowerCase().includes(query),
  );
}
