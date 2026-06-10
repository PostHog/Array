import { CircleNotch, GitBranch, Warning } from "@phosphor-icons/react";
import type { HomeActiveAgent } from "@posthog/core/home/schemas";
import { formatRelativeTimeShort } from "@posthog/shared";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { openTask } from "@posthog/ui/router/useOpenTask";
import { Box, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useMemo } from "react";

interface HomeActiveAgentsStripProps {
  agents: HomeActiveAgent[];
}

export function HomeActiveAgentsStrip({ agents }: HomeActiveAgentsStripProps) {
  const { data: tasks = [] } = useTasks();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  if (agents.length === 0) return null;

  return (
    <Box className="border-(--gray-3) border-b px-4 py-3">
      <Flex align="center" gap="2" mb="2">
        <CircleNotch
          size={13}
          className="animate-spin text-(--green-11)"
          weight="bold"
        />
        <Text className="font-semibold text-[12px] text-gray-12">Running</Text>
        <Text className="rounded-full bg-(--gray-a3) px-1.5 py-px font-medium text-(--gray-11) text-[10.5px] tabular-nums">
          {agents.length}
        </Text>
      </Flex>
      <ScrollArea scrollbars="horizontal">
        <Flex gap="2" className="pb-1">
          {agents.map((agent) => {
            const task = taskById.get(agent.taskId);
            const dotColor = agent.needsPermission
              ? "var(--amber-9)"
              : agent.status === "queued"
                ? "var(--gray-8)"
                : "var(--green-9)";
            return (
              <button
                key={agent.taskId}
                type="button"
                onClick={() => {
                  if (task) void openTask(task);
                }}
                className="group hover:-translate-y-px flex min-w-[260px] max-w-[320px] shrink-0 cursor-pointer flex-col items-start gap-1.5 rounded-lg border border-(--gray-4) bg-(--color-panel-solid) px-3 py-2.5 text-left transition-all hover:border-(--gray-7) hover:shadow-sm"
              >
                <Flex
                  align="center"
                  gap="2"
                  justify="between"
                  className="w-full"
                >
                  <Flex align="center" gap="2" className="min-w-0">
                    <span
                      className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full"
                      style={{ backgroundColor: dotColor }}
                    />
                    <Text
                      className="truncate font-medium text-[13px] text-gray-12 leading-tight"
                      title={agent.title}
                    >
                      {agent.title || "Untitled task"}
                    </Text>
                  </Flex>
                  <Text className="shrink-0 text-(--gray-9) text-[11px]">
                    {formatRelativeTimeShort(agent.lastActivityAt)}
                  </Text>
                </Flex>
                <Flex
                  align="center"
                  gap="2"
                  className="w-full pl-4 text-(--gray-10) text-[11px]"
                >
                  {agent.repoName ? (
                    <span className="shrink-0 text-(--gray-11)">
                      {agent.repoName}
                    </span>
                  ) : null}
                  {agent.branch ? (
                    <Flex align="center" gap="1" className="min-w-0">
                      <GitBranch size={10} className="shrink-0" />
                      <span className="truncate" title={agent.branch}>
                        {agent.branch}
                      </span>
                    </Flex>
                  ) : null}
                  {agent.needsPermission ? (
                    <Flex
                      align="center"
                      gap="1"
                      className="shrink-0 text-(--amber-11)"
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
