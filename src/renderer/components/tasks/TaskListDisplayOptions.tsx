import {
  ArrowsDownUpIcon,
  FolderIcon,
  SlidersHorizontalIcon,
  SortAscendingIcon,
  SortDescendingIcon,
} from "@phosphor-icons/react";
import {
  Flex,
  IconButton,
  Popover,
  Select,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import {
  type GroupByField,
  type OrderByField,
  useTaskStore,
} from "@stores/taskStore";

export function TaskListDisplayOptions() {
  const orderBy = useTaskStore((state) => state.orderBy);
  const orderDirection = useTaskStore((state) => state.orderDirection);
  const groupBy = useTaskStore((state) => state.groupBy);
  const setOrderBy = useTaskStore((state) => state.setOrderBy);
  const setOrderDirection = useTaskStore((state) => state.setOrderDirection);
  const setGroupBy = useTaskStore((state) => state.setGroupBy);

  return (
    <Popover.Root>
      <Popover.Trigger>
        <IconButton
          size="1"
          variant="outline"
          color="gray"
          title="Display options"
        >
          <SlidersHorizontalIcon weight="regular" />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content style={{ width: 320 }}>
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <ArrowsDownUpIcon weight="regular" />
            <Text size="1" weight="medium">
              Ordering
            </Text>
            <Select.Root
              size="1"
              value={orderBy}
              onValueChange={(value) => setOrderBy(value as OrderByField)}
            >
              <Select.Trigger style={{ flex: 1 }} />
              <Select.Content>
                <Select.Item value="created_at">Created at</Select.Item>
                <Select.Item value="status">Status</Select.Item>
                <Select.Item value="title">Title</Select.Item>
                <Select.Item value="repository">Repository</Select.Item>
                <Select.Item value="working_directory">
                  Working Directory
                </Select.Item>
                <Select.Item value="source">Source</Select.Item>
              </Select.Content>
            </Select.Root>
            <Tooltip
              content={orderDirection === "asc" ? "Ascending" : "Descending"}
            >
              <IconButton
                size="1"
                color="gray"
                variant="outline"
                onClick={() =>
                  setOrderDirection(orderDirection === "asc" ? "desc" : "asc")
                }
              >
                {orderDirection === "asc" ? (
                  <SortAscendingIcon weight="regular" />
                ) : (
                  <SortDescendingIcon weight="regular" />
                )}
              </IconButton>
            </Tooltip>
          </Flex>
          <Flex align="center" gap="2">
            <FolderIcon weight="regular" />
            <Text size="1" weight="medium">
              Grouping
            </Text>
            <Select.Root
              size="1"
              value={groupBy}
              onValueChange={(value) => setGroupBy(value as GroupByField)}
            >
              <Select.Trigger style={{ flex: 1 }} />
              <Select.Content>
                <Select.Item value="none">None</Select.Item>
                <Select.Item value="status">Status</Select.Item>
                <Select.Item value="creator">Creator</Select.Item>
                <Select.Item value="source">Source</Select.Item>
                <Select.Item value="repository">Repository</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
