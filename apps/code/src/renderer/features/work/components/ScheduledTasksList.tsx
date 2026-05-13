import { useSetHeaderContent } from "@hooks/useSetHeaderContent";
import { ClockCounterClockwise, Plus } from "@phosphor-icons/react";
import { Box, Button, Flex, ScrollArea, Spinner, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { useMemo } from "react";
import { useScheduledTasks } from "../hooks/useScheduledTasks";
import { type PendingCreateDraft, useWorkStore } from "../stores/workStore";
import { EmptyState } from "./EmptyState";
import { ScheduledTaskRow } from "./ScheduledTaskRow";

export function ScheduledTasksList() {
  const navigateToCreate = useNavigationStore(
    (s) => s.navigateToWorkScheduledCreate,
  );
  const navigateToEdit = useNavigationStore(
    (s) => s.navigateToWorkScheduledEdit,
  );
  const setPendingCreateDraft = useWorkStore((s) => s.setPendingCreateDraft);
  const { data: automations, isLoading } = useScheduledTasks();

  const handleCreate = (initial?: PendingCreateDraft) => {
    setPendingCreateDraft(initial ?? null);
    navigateToCreate();
  };

  const items = automations ?? [];

  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="min-w-0">
        <ClockCounterClockwise
          size={12}
          className="shrink-0 text-(--gray-10)"
        />
        <Text
          size="1"
          weight="medium"
          className="truncate font-mono text-[12px]"
        >
          Scheduled tasks
        </Text>
      </Flex>
    ),
    [],
  );
  useSetHeaderContent(headerContent);

  return (
    <Flex direction="column" height="100%" className="overflow-hidden">
      <Flex
        align="center"
        justify="between"
        px="4"
        py="3"
        className="shrink-0 border-(--gray-6) border-b"
      >
        <Flex direction="column" gap="1">
          <Text size="3" weight="medium" className="text-(--gray-12)">
            Scheduled tasks
          </Text>
          <Text size="1" className="text-(--gray-10)">
            {items.length === 0
              ? "Nothing scheduled yet"
              : `${items.length} scheduled task${items.length === 1 ? "" : "s"}`}
          </Text>
        </Flex>
        <Button size="2" onClick={() => handleCreate()}>
          <Plus size={14} />
          New
        </Button>
      </Flex>

      <ScrollArea type="auto" className="min-h-0 flex-1">
        <Box px="4" py="3">
          {isLoading && items.length === 0 ? (
            <Flex align="center" justify="center" className="py-16">
              <Spinner size="3" />
            </Flex>
          ) : items.length === 0 ? (
            <EmptyState onCreate={handleCreate} />
          ) : (
            <Flex direction="column" gap="2">
              {items.map((automation) => (
                <ScheduledTaskRow
                  key={automation.id}
                  automation={automation}
                  onClick={() => navigateToEdit(automation.id)}
                />
              ))}
            </Flex>
          )}
        </Box>
      </ScrollArea>
    </Flex>
  );
}
