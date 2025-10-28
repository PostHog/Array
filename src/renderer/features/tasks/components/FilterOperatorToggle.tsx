import type {
  FilterCategory,
  FilterOperator,
} from "@features/tasks/stores/taskStore";
import { useTaskStore } from "@features/tasks/stores/taskStore";
import { DropdownMenu, Text } from "@radix-ui/themes";

interface FilterOperatorToggleProps {
  category: FilterCategory;
  value: string;
  operator: FilterOperator;
}

export function FilterOperatorToggle({
  category,
  value,
  operator,
}: FilterOperatorToggleProps) {
  const toggleFilterOperator = useTaskStore(
    (state) => state.toggleFilterOperator,
  );

  const isDateCategory = category === "created_at";

  const getOperatorLabel = (op: FilterOperator) => {
    switch (op) {
      case "is":
        return "is";
      case "is_not":
        return "is not";
      case "before":
        return "before";
      case "after":
        return "after";
    }
  };

  const setOperator = (newOperator: FilterOperator) => {
    if (operator !== newOperator) {
      toggleFilterOperator(category, value);
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button
          type="button"
          className="cursor-pointer rounded px-1 py-0.5 opacity-50 hover:bg-gray-5 hover:opacity-100"
        >
          {getOperatorLabel(operator)}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {isDateCategory ? (
          <>
            <DropdownMenu.Item
              className="hover:bg-gray-5"
              onSelect={(e) => {
                e.preventDefault();
                setOperator("before");
              }}
            >
              <Text size="1">before</Text>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="hover:bg-gray-5"
              onSelect={(e) => {
                e.preventDefault();
                setOperator("after");
              }}
            >
              <Text size="1">after</Text>
            </DropdownMenu.Item>
          </>
        ) : (
          <>
            <DropdownMenu.Item
              className="hover:bg-gray-5"
              onSelect={(e) => {
                e.preventDefault();
                setOperator("is");
              }}
            >
              <Text size="1">is</Text>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="hover:bg-gray-5"
              onSelect={(e) => {
                e.preventDefault();
                setOperator("is_not");
              }}
            >
              <Text size="1">is not</Text>
            </DropdownMenu.Item>
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
