import { useTaskStore } from "@features/tasks/stores/taskStore";
import { Button } from "@radix-ui/themes";

export function TaskFilterMatchToggle() {
  const filterMatchMode = useTaskStore((state) => state.filterMatchMode);
  const setFilterMatchMode = useTaskStore((state) => state.setFilterMatchMode);
  const totalActiveFilterCount = useTaskStore((state) => {
    return Object.values(state.activeFilters).reduce(
      (sum, filters) => sum + (filters?.length || 0),
      0,
    );
  });

  if (totalActiveFilterCount <= 1) return null;

  const toggleMode = () => {
    setFilterMatchMode(filterMatchMode === "all" ? "any" : "all");
  };

  return (
    <Button
      size="1"
      variant="ghost"
      color="gray"
      onClick={toggleMode}
      style={{ cursor: "pointer" }}
    >
      Match {filterMatchMode === "all" ? "all filters" : "any filter"}
    </Button>
  );
}
