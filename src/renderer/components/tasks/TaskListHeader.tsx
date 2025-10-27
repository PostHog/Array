import { TaskListDisplayOptions } from "@components/tasks/TaskListDisplayOptions";
import { TaskSearch } from "@components/tasks/TaskSearch";
import { Box, Flex } from "@radix-ui/themes";

interface TaskListHeaderProps {
  filter: string;
  onFilterChange: (filter: string) => void;
}

export function TaskListHeader({
  filter,
  onFilterChange,
}: TaskListHeaderProps) {
  return (
    <Box px="2" py="4" className="border-gray-6 border-b">
      <Flex gap="2">
        <TaskListDisplayOptions />
        <TaskSearch value={filter} onChange={onFilterChange} />
      </Flex>
    </Box>
  );
}
