import { useTaskStore } from "@features/tasks/stores/taskStore";
import { Button } from "@radix-ui/themes";

export function TaskFilterClearButton() {
  const clearActiveFilters = useTaskStore((state) => state.clearActiveFilters);
  const totalActiveFilterCount = useTaskStore((state) => {
    return Object.values(state.activeFilters).reduce(
      (sum, filters) => sum + (filters?.length || 0),
      0,
    );
  });

  if (totalActiveFilterCount === 0) return null;

  return (
    <Button
      size="1"
      variant="ghost"
      color="gray"
      onClick={clearActiveFilters}
      style={{ cursor: "pointer" }}
    >
      Clear
    </Button>
  );
}
