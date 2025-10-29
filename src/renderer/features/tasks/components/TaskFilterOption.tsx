import type { FilterCategory } from "@features/tasks/stores/taskStore";
import { DropdownMenu, Text } from "@radix-ui/themes";

interface TaskFilterOptionProps {
  category: FilterCategory;
  label: string;
  value: string;
  onToggle: (category: FilterCategory, value: string) => void;
}

export function TaskFilterOption({
  category,
  label,
  value,
  onToggle,
}: TaskFilterOptionProps) {
  return (
    <DropdownMenu.Item
      className="hover:bg-gray-5"
      onSelect={(e) => {
        e.preventDefault();
        onToggle(category, value);
      }}
    >
      <Text size="1">{label}</Text>
    </DropdownMenu.Item>
  );
}
