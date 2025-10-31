import type { ActiveFilters } from "@features/tasks/stores/taskStore";

const normalizeFilters = (filters: ActiveFilters) => {
  const sorted: Record<string, Array<{ value: string; operator: string }>> = {};
  for (const [key, values] of Object.entries(filters)) {
    if (values && values.length > 0) {
      sorted[key] = [...values].sort((a, b) =>
        `${a.value}:${a.operator}`.localeCompare(`${b.value}:${b.operator}`),
      );
    }
  }
  return JSON.stringify(sorted);
};

export function filtersMatch(
  filters1: ActiveFilters,
  filters2: ActiveFilters,
): boolean {
  return normalizeFilters(filters1) === normalizeFilters(filters2);
}
