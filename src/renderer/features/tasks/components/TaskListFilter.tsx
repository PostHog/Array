import { TaskFilterBadges } from "@features/tasks/components/TaskFilterBadges";
import { TaskFilterCategory } from "@features/tasks/components/TaskFilterCategory";
import { TaskFilterSearch } from "@features/tasks/components/TaskFilterSearch";
import { useTasks } from "@features/tasks/hooks/useTasks";
import {
  type FilterCategory,
  useTaskStore,
} from "@features/tasks/stores/taskStore";
import {
  type FilterCategoryConfig,
  getFilterCategories,
} from "@features/tasks/utils/filterCategories";
import { FunnelIcon } from "@phosphor-icons/react";
import { Button, DropdownMenu, Flex, Text } from "@radix-ui/themes";
import { useEffect } from "react";

export function TaskListFilter() {
  const { data: tasks = [] } = useTasks();
  const activeFilters = useTaskStore((state) => state.activeFilters);
  const toggleFilter = useTaskStore((state) => state.toggleFilter);
  const addFilter = useTaskStore((state) => state.addFilter);
  const searchQuery = useTaskStore((state) => state.filterSearchQuery);
  const setSearchQuery = useTaskStore((state) => state.setFilterSearchQuery);
  const isOpen = useTaskStore((state) => state.isFilterDropdownOpen);
  const setIsOpen = useTaskStore((state) => state.setIsFilterDropdownOpen);

  const filterCategories = getFilterCategories(tasks);

  // Filter categories by search query
  const query = searchQuery.toLowerCase();
  const hasSearchQuery = searchQuery.trim().length > 0;

  // When searching, show categories only if category name matches
  const filteredCategories = !hasSearchQuery
    ? filterCategories
    : filterCategories
        .map((category) => {
          const categoryMatch = category.label.toLowerCase().includes(query);
          if (!categoryMatch) return null;

          // Show all options when category matches
          return category;
        })
        .filter((cat): cat is FilterCategoryConfig => cat !== null);

  // When searching, create flat list of all matched options
  const flatFilteredOptions = hasSearchQuery
    ? filterCategories.flatMap((category) => {
        const categoryMatch = category.label.toLowerCase().includes(query);
        const matchedOptions = category.options.filter(
          (option) =>
            categoryMatch || option.label.toLowerCase().includes(query),
        );

        return matchedOptions.map((option) => ({
          category: category.category,
          categoryLabel: category.label,
          optionValue: option.value,
          optionLabel: option.label,
        }));
      })
    : [];

  const hasMoreThanThreeOptions =
    filterCategories.reduce((sum, cat) => sum + cat.options.length, 0) > 3;

  const totalActiveFilterCount = Object.values(activeFilters).reduce(
    (sum, filters) => sum + (filters?.length || 0),
    0,
  );

  const isFilterActive = (category: FilterCategory, value: string): boolean => {
    return activeFilters[category]?.some((f) => f.value === value) ?? false;
  };

  const handleToggleFilter = (category: FilterCategory, value: string) => {
    addFilter(category, value);
    setIsOpen(false);
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setSearchQuery("");
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "f" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return;
        }
        e.preventDefault();

        if (isOpen) {
          // If already open, focus the search input
          const searchInput = document.querySelector(
            'input[placeholder*="Filter"]',
          ) as HTMLInputElement;
          searchInput?.focus();
        } else {
          setIsOpen(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, setIsOpen]);

  return (
    <TaskFilterBadges
      activeFilters={activeFilters}
      filterCategories={filterCategories}
      onRemoveFilter={toggleFilter}
      isFilterActive={isFilterActive}
      onToggleFilter={handleToggleFilter}
    >
      <DropdownMenu.Root open={isOpen} onOpenChange={handleOpenChange}>
        <DropdownMenu.Trigger>
          <Button
            size="1"
            variant="outline"
            color="gray"
            title="Filter tasks (F)"
          >
            <FunnelIcon weight="regular" />
            {totalActiveFilterCount === 0 && "Filter"}
          </Button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Content>
          {hasMoreThanThreeOptions && (
            <TaskFilterSearch
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search filters..."
            />
          )}

          {filteredCategories.length === 0 &&
          flatFilteredOptions.length === 0 ? (
            <Flex p="3" justify="center">
              <Text size="1" color="gray">
                No filters found
              </Text>
            </Flex>
          ) : (
            <>
              {filteredCategories.map((config) => (
                <TaskFilterCategory
                  key={config.category}
                  config={config}
                  onToggleFilter={handleToggleFilter}
                />
              ))}
              {flatFilteredOptions.map((option) => (
                <DropdownMenu.Item
                  key={`${option.category}-${option.optionValue}`}
                  onSelect={(e) => {
                    e.preventDefault();
                    handleToggleFilter(
                      option.category as FilterCategory,
                      option.optionValue,
                    );
                  }}
                >
                  <Text size="1">
                    {option.categoryLabel} → {option.optionLabel}
                  </Text>
                </DropdownMenu.Item>
              ))}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </TaskFilterBadges>
  );
}
