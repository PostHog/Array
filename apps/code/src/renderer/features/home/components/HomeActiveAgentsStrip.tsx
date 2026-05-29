import { CircleNotch, GitBranch, Warning } from "@phosphor-icons/react";
import { Box, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useTasks } from "@renderer/features/tasks/hooks/useTasks";
import { useNavigationStore } from "@stores/navigationStore";
import { formatRelativeTimeShort } from "@utils/time";
import type { HomeActiveAgent } from "../hooks/useHomeSnapshot";

interface HomeActiveAgentsStripProps {
  agents: HomeActiveAgent[];
}

export function HomeActiveAgentsStrip({ agents }: HomeActiveAgentsStripProps) {
  const { data: tasks = [] } = useTasks();
  const navigateToTask = useNavigationStore((s) => s.navigateToTask);

  if (agents.length === 0) return null;

  return (
    <Box className="border-(--gray-4) border-b px-5 py-3">
      <Flex align="center" gap="2" mb="2">
        <CircleNotch
          size={12}
          className="animate-spin text-(--gray-10)"
          weight="bold"
        />
        <Text className="font-medium text-(--gray-11) text-[11px] uppercase tracking-wide">
          Running ({agents.length})
        </Text>
      </Flex>
      <ScrollArea scrollbars="horizontal">
        <Flex gap="2" className="pb-1">
          {agents.map((agent) => {
            const task = tasks.find((t) => t.id === agent.taskId);
            return (
              <button
                key={agent.taskId}
                type="button"
                onClick={() => {
                  if (task) navigateToTask(task);
                }}
                className="group flex min-w-[260px] max-w-[320px] shrink-0 cursor-pointer flex-col items-start gap-1 rounded-md border border-(--gray-4) bg-(--gray-2) px-3 py-2 text-left hover:border-(--gray-6) hover:bg-(--gray-3)"
              >
                <Flex
                  align="center"
                  gap="1"
                  justify="between"
                  className="w-full"
                >
                  <Text
                    className="truncate font-medium text-[13px] text-gray-12 leading-tight"
                    title={agent.title}
                  >
                    {agent.title || "Untitled task"}
                  </Text>
                  <Text className="shrink-0 text-(--gray-10) text-[11px]">
                    {formatRelativeTimeShort(agent.lastActivityAt)}
                  </Text>
                </Flex>
                <Flex
                  align="center"
                  gap="2"
                  className="w-full text-(--gray-10) text-[11px]"
                >
                  {agent.branch ? (
                    <Flex align="center" gap="1" className="min-w-0">
                      <GitBranch size={10} />
                      <span className="truncate" title={agent.branch}>
                        {agent.branch}
                      </span>
                    </Flex>
                  ) : null}
                  {agent.needsPermission ? (
                    <Flex
                      align="center"
                      gap="1"
                      className="text-(--amber-11)"
                      title="Waiting on permission"
                    >
                      <Warning size={10} weight="fill" />
                      <span>Needs input</span>
                    </Flex>
                  ) : null}
                </Flex>
              </button>
            );
          })}
        </Flex>
      </ScrollArea>
    </Box>
  );
}
