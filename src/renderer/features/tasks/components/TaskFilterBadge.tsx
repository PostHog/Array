import { FilterOperatorToggle } from "@features/tasks/components/FilterOperatorToggle";
import { TaskFilterValueEditor } from "@features/tasks/components/TaskFilterValueEditor";
import type {
  FilterCategory,
  FilterOperator,
} from "@features/tasks/stores/taskStore";
import { useTaskStore } from "@features/tasks/stores/taskStore";
import type { FilterCategoryConfig } from "@features/tasks/utils/filterCategories";
import { Cross2Icon } from "@radix-ui/react-icons";
import { Badge, DropdownMenu, Flex, Separator } from "@radix-ui/themes";

interface TaskFilterBadgeProps {
  category: FilterCategory;
  categoryLabel: string;
  value: string;
  valueLabel: string;
  operator: FilterOperator;
  badgeKey: string;
  categoryConfig: FilterCategoryConfig | undefined;
  onRemoveFilter: (category: FilterCategory, value: string) => void;
  onToggleFilter: (category: FilterCategory, value: string) => void;
}

export function TaskFilterBadge({
  category,
  categoryLabel,
  value,
  valueLabel,
  operator,
  badgeKey,
  categoryConfig,
  onRemoveFilter,
  onToggleFilter,
}: TaskFilterBadgeProps) {
  const editingBadgeKey = useTaskStore((state) => state.editingFilterBadgeKey);
  const setEditingBadgeKey = useTaskStore(
    (state) => state.setEditingFilterBadgeKey,
  );
  const isEditing = editingBadgeKey === badgeKey;

  return (
    <DropdownMenu.Root
      open={isEditing}
      onOpenChange={(open) => {
        setEditingBadgeKey(open ? badgeKey : null);
      }}
    >
      <Badge size="1" color="gray" variant="soft">
        <Flex align="center" gap="0">
          <span className="font-medium">{categoryLabel}</span>
          <Separator orientation="vertical" mx="1" />
          <FilterOperatorToggle
            category={category}
            value={value}
            operator={operator}
          />
          <Separator orientation="vertical" mx="1" />
          <DropdownMenu.Trigger>
            <button
              type="button"
              className="cursor-pointer rounded px-1 py-0.5 font-medium hover:bg-gray-5"
            >
              {valueLabel}
            </button>
          </DropdownMenu.Trigger>
          <Separator orientation="vertical" mx="1" />
          <button
            type="button"
            className="flex cursor-pointer items-center justify-center rounded p-0.5 hover:bg-gray-5"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemoveFilter(category, value);
              setEditingBadgeKey(null);
            }}
          >
            <Cross2Icon width="10" height="10" />
          </button>
        </Flex>
      </Badge>
      <DropdownMenu.Content className="min-w-[200px]">
        {categoryConfig && (
          <TaskFilterValueEditor
            config={categoryConfig}
            onToggleFilter={onToggleFilter}
          />
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
