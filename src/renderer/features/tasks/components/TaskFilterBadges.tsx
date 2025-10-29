import { TaskFilterBadge } from "@features/tasks/components/TaskFilterBadge";
import type {
  ActiveFilters,
  FilterCategory,
  FilterOperator,
} from "@features/tasks/stores/taskStore";
import { useTaskStore } from "@features/tasks/stores/taskStore";
import type { FilterCategoryConfig } from "@features/tasks/utils/filterCategories";
import { Flex } from "@radix-ui/themes";
import type { ReactNode } from "react";

interface TaskFilterBadgesProps {
  activeFilters: ActiveFilters;
  filterCategories: FilterCategoryConfig[];
  onRemoveFilter: (category: FilterCategory, value: string) => void;
  onUpdateFilter: (
    category: FilterCategory,
    oldValue: string,
    newValue: string,
  ) => void;
  children?: ReactNode;
}

export function TaskFilterBadges({
  activeFilters,
  filterCategories,
  onRemoveFilter,
  onUpdateFilter,
  children,
}: TaskFilterBadgesProps) {
  const setEditingBadgeKey = useTaskStore(
    (state) => state.setEditingFilterBadgeKey,
  );
  const badges: Array<{
    category: FilterCategory;
    categoryLabel: string;
    value: string;
    valueLabel: string;
    operator: FilterOperator;
  }> = [];

  for (const [category, filterValues] of Object.entries(activeFilters)) {
    if (!filterValues || filterValues.length === 0) continue;

    const categoryConfig = filterCategories.find(
      (c) => c.category === category,
    );
    if (!categoryConfig) continue;

    for (const filterValue of filterValues) {
      const option = categoryConfig.options.find(
        (o) => o.value === filterValue.value,
      );
      badges.push({
        category: category as FilterCategory,
        categoryLabel: categoryConfig.label,
        value: filterValue.value,
        valueLabel: option?.label || filterValue.value,
        operator: filterValue.operator,
      });
    }
  }

  const handleToggleFilterFromBadge = (
    category: FilterCategory,
    oldValue: string,
    newValue: string,
  ) => {
    onUpdateFilter(category, oldValue, newValue);
    setEditingBadgeKey(null);
  };

  return (
    <Flex gap="1" wrap="wrap" align="center" style={{ maxWidth: "60%" }}>
      {badges.map((badge) => {
        const categoryConfig = filterCategories.find(
          (c) => c.category === badge.category,
        );
        const badgeKey = `${badge.category}-${badge.value}`;

        return (
          <TaskFilterBadge
            key={badgeKey}
            category={badge.category}
            categoryLabel={badge.categoryLabel}
            value={badge.value}
            valueLabel={badge.valueLabel}
            operator={badge.operator}
            badgeKey={badgeKey}
            categoryConfig={categoryConfig}
            onRemoveFilter={onRemoveFilter}
            onToggleFilter={(category, newValue) =>
              handleToggleFilterFromBadge(category, badge.value, newValue)
            }
          />
        );
      })}
      {children}
    </Flex>
  );
}
