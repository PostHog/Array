import {
  ArrowSquareOut,
  CaretDown,
  ChatCircle,
  GitBranch,
  GitPullRequest,
  Sparkle,
  Warning,
} from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Box, DropdownMenu, Flex, Text } from "@radix-ui/themes";
import { useTasks } from "@renderer/features/tasks/hooks/useTasks";
import { useNavigationStore } from "@stores/navigationStore";
import { openUrlInBrowser } from "@utils/browser";
import { formatRelativeTimeShort } from "@utils/time";
import { type BoundAction, useBoundActions } from "../hooks/useBoundActions";
import { useRunWorkstreamAction } from "../hooks/useRunWorkstreamAction";
import { useHomeUiStore } from "../stores/homeUiStore";
import type { HomeWorkstream } from "../utils/buildSnapshot";
import {
  severityRingClass,
  situationSeverity,
} from "../utils/situationDisplay";
import { SituationChip } from "./SituationChip";

interface HomeWorkstreamRowProps {
  workstream: HomeWorkstream;
}

export function HomeWorkstreamRow({ workstream }: HomeWorkstreamRowProps) {
  const { data: tasks = [] } = useTasks();
  const navigateToTask = useNavigationStore((s) => s.navigateToTask);
  const boundActions = useBoundActions(workstream);
  const runAction = useRunWorkstreamAction();
  const setSelectedWorkstreamId = useHomeUiStore(
    (s) => s.setSelectedWorkstreamId,
  );
  const isSelected = useHomeUiStore(
    (s) => s.selectedWorkstreamId === workstream.id,
  );

  const headTask = workstream.tasks[0];
  const title = headTask?.title ?? workstream.branch ?? "Workstream";
  const taskCount = workstream.tasks.length;
  const severity = situationSeverity(workstream.situations);
  const inlineActions = boundActions.slice(0, 2);
  const overflowActions = boundActions.slice(2);

  function handleRunAction(action: BoundAction) {
    runAction(action, workstream);
  }

  function handleOpenTask() {
    if (!headTask) return;
    const task = tasks.find((t) => t.id === headTask.id);
    if (task) navigateToTask(task);
  }

  function handleOpenPr() {
    if (workstream.prUrl) void openUrlInBrowser(workstream.prUrl);
  }

  return (
    <Box
      onClick={() => setSelectedWorkstreamId(workstream.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setSelectedWorkstreamId(workstream.id);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${title}`}
      className={`cursor-pointer border-(--gray-4) border-b px-5 py-3 transition-colors hover:bg-(--gray-2) ${
        isSelected ? "bg-(--accent-3)" : ""
      } ${severityRingClass(severity)}`}
    >
      <Flex align="start" justify="between" gap="3">
        <Flex direction="column" gap="2" className="min-w-0 flex-1">
          <Flex align="center" gap="2" wrap="wrap" className="min-w-0">
            <Text
              className="truncate font-medium text-[13px] text-gray-12"
              title={title}
            >
              {title}
            </Text>
            {workstream.situations.map((sid) => (
              <SituationChip key={sid} sid={sid} />
            ))}
            {taskCount > 1 ? (
              <Text className="shrink-0 text-(--gray-10) text-[11px]">
                · {taskCount} tasks
              </Text>
            ) : null}
          </Flex>

          <Flex
            align="center"
            gap="3"
            wrap="wrap"
            className="text-(--gray-10) text-[11px]"
          >
            {workstream.repoName ? (
              <Text title="Repository">{workstream.repoName}</Text>
            ) : null}
            {workstream.branch ? (
              <Flex align="center" gap="1" className="min-w-0">
                <GitBranch size={10} />
                <span className="truncate" title={workstream.branch}>
                  {workstream.branch}
                </span>
              </Flex>
            ) : null}
            {headTask?.needsPermission ? (
              <Flex align="center" gap="1" className="text-(--amber-11)">
                <Warning size={11} weight="fill" />
                <span>Awaiting permission</span>
              </Flex>
            ) : null}
            {workstream.tasks.some((t) => t.isGenerating) ? (
              <Flex align="center" gap="1">
                <ChatCircle size={11} />
                <span>Generating</span>
              </Flex>
            ) : null}
            <Text>{formatRelativeTimeShort(workstream.lastActivityAt)}</Text>
          </Flex>
        </Flex>

        <Flex
          align="center"
          gap="2"
          wrap="wrap"
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {inlineActions.map((action, idx) => (
            <Button
              key={`${action.situationId}::${action.id}`}
              variant={idx === 0 ? "primary" : "outline"}
              size="sm"
              onClick={() => handleRunAction(action)}
              title={`${action.situationLabel} → ${action.skillId}`}
            >
              <Sparkle size={12} />
              {action.label}
            </Button>
          ))}
          {overflowActions.length > 0 ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <Button
                  variant="outline"
                  size="sm"
                  title={`${overflowActions.length} more quick action${overflowActions.length === 1 ? "" : "s"}`}
                >
                  +{overflowActions.length}
                  <CaretDown size={10} />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {overflowActions.map((action) => (
                  <DropdownMenu.Item
                    key={`${action.situationId}::${action.id}`}
                    onSelect={() => handleRunAction(action)}
                  >
                    <Sparkle size={12} />
                    {action.label}
                    <Text className="ml-auto pl-3 text-(--gray-10) text-[10px]">
                      {action.situationLabel}
                    </Text>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          ) : null}
          {workstream.prUrl ? (
            <Button variant="link-muted" size="sm" onClick={handleOpenPr}>
              <GitPullRequest size={12} />
              PR
              <ArrowSquareOut size={10} />
            </Button>
          ) : null}
          <Button variant="link-muted" size="sm" onClick={handleOpenTask}>
            Open task
          </Button>
        </Flex>
      </Flex>
    </Box>
  );
}
