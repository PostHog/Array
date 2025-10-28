import { TaskFilterOption } from "@features/tasks/components/TaskFilterOption";
import type { FilterCategory } from "@features/tasks/stores/taskStore";
import type { FilterCategoryConfig } from "@features/tasks/utils/filterCategories";

interface TaskFilterValueEditorProps {
  config: FilterCategoryConfig;
  onToggleFilter: (category: FilterCategory, value: string) => void;
}

export function TaskFilterValueEditor({
  config,
  onToggleFilter,
}: TaskFilterValueEditorProps) {
  return (
    <>
      {config.options.map((option) => (
        <TaskFilterOption
          key={option.value}
          category={config.category}
          label={option.label}
          value={option.value}
          onToggle={onToggleFilter}
        />
      ))}
    </>
  );
}
