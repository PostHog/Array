import { PlusIcon } from "@radix-ui/react-icons";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { TaskListDisplayOptions } from "./TaskListDisplayOptions";
import { TaskSearch } from "./TaskSearch";

interface TaskListHeaderProps {
  filter: string;
  onFilterChange: (filter: string) => void;
  onNewTask?: () => void;
}

export function TaskListHeader({
  filter,
  onFilterChange,
  onNewTask,
}: TaskListHeaderProps) {
  return (
    <Box px="2" py="4" className="border-gray-6 border-b">
      <Flex gap="2">
        <TaskListDisplayOptions />
        <TaskSearch value={filter} onChange={onFilterChange} />
        <IconButton
          size="2"
          variant="classic"
          onClick={onNewTask}
          title="New task (⌘N)"
        >
          <PlusIcon />
        </IconButton>
      </Flex>
    </Box>
  );
}
