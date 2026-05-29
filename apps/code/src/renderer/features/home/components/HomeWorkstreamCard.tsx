import {
  CaretDown,
  CheckCircle,
  GitBranch,
  Sparkle,
  Warning,
  XCircle,
} from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Box, DropdownMenu, Flex, Text } from "@radix-ui/themes";
import { useTasks } from "@renderer/features/tasks/hooks/useTasks";
import { useNavigationStore } from "@stores/navigationStore";
import { openUrlInBrowser } from "@utils/browser";
import { formatRelativeTimeShort } from "@utils/time";
import { type BoundAction, useBoundActions } from "../hooks/useBoundActions";
import type { HomePullRequest, HomeWorkstream } from "../hooks/useHomeSnapshot";
import { useRunWorkstreamAction } from "../hooks/useRunWorkstreamAction";
import { useHomeUiStore } from "../stores/homeUiStore";
import {
  severityRingClass,
  situationSeverity,
} from "../utils/situationDisplay";
import { SituationChip } from "./SituationChip";

interface HomeWorkstreamCardProps {
  workstream: HomeWorkstream;
}

function CiDot({ status }: { status: HomePullRequest["ciStatus"] }) {
  if (status === "passing") {
    return (
      <span title="CI passing">
        <CheckCircle size={11} weight="fill" className="text-(--green-9)" />
      </span>
    );
  }
  if (status === "failing") {
    return (
      <span title="CI failing">
        <XCircle size={11} weight="fill" className="text-(--red-9)" />
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span
        className="inline-block h-[8px] w-[8px] animate-pulse rounded-full bg-(--amber-9)"
        title="CI pending"
      />
    );
  }
  return null;
}

export function HomeWorkstreamCard({ workstream }: HomeWorkstreamCardProps) {
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
  const pr = workstream.pr;
  const title =
    pr?.title ?? headTask?.title ?? workstream.branch ?? "Workstream";
  const taskCount = workstream.tasks.length;
  const severity = situationSeverity(workstream.situations);
  const primaryBound = boundActions[0] ?? null;
  const overflowBound = boundActions.slice(1);

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
      className={`cursor-pointer rounded-md border border-(--gray-4) bg-(--color-panel-solid) p-3 transition-colors hover:border-(--gray-6) hover:shadow-sm ${
        isSelected ? "border-(--accent-9) ring-(--accent-7) ring-2" : ""
      } ${severityRingClass(severity)}`}
    >
      <Flex direction="column" gap="2">
        <Flex align="start" justify="between" gap="2">
          <Text
            className="line-clamp-2 font-medium text-[13px] text-gray-12 leading-tight"
            title={title}
          >
            {title}
          </Text>
          {pr ? <CiDot status={pr.ciStatus} /> : null}
        </Flex>

        <Flex
          align="center"
          gap="2"
          wrap="wrap"
          className="text-(--gray-10) text-[11px]"
        >
          {workstream.repoName ? (
            <Text title="Repository">{workstream.repoName}</Text>
          ) : null}
          {workstream.branch ? (
            <Flex align="center" gap="1" className="min-w-0">
              <GitBranch size={10} />
              <span
                className="max-w-[140px] truncate"
                title={workstream.branch}
              >
                {workstream.branch}
              </span>
            </Flex>
          ) : null}
          {pr ? <Text>#{pr.number}</Text> : null}
          <Text>{formatRelativeTimeShort(workstream.lastActivityAt)}</Text>
        </Flex>

        {workstream.situations.length > 0 ? (
          <Flex align="center" gap="1" wrap="wrap">
            {workstream.situations.map((sid) => (
              <SituationChip key={sid} sid={sid} />
            ))}
          </Flex>
        ) : null}

        {pr?.reviewDecision === "changes_requested" ? (
          <Flex
            align="center"
            gap="1"
            className="text-(--amber-11) text-[11px]"
          >
            <Warning size={11} weight="fill" />
            <span>Changes requested</span>
          </Flex>
        ) : null}
        {pr?.reviewDecision === "approved" ? (
          <Flex
            align="center"
            gap="1"
            className="text-(--green-11) text-[11px]"
          >
            <CheckCircle size={11} weight="fill" />
            <span>Approved</span>
          </Flex>
        ) : null}

        <Flex
          align="center"
          gap="1.5"
          justify="between"
          wrap="wrap"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {primaryBound ? (
            <Flex align="center" gap="1">
              <Button
                variant="primary"
                size="xs"
                onClick={() => handleRunAction(primaryBound)}
                title={`${primaryBound.situationLabel} → ${primaryBound.skillId}`}
              >
                <Sparkle size={11} />
                {primaryBound.label}
              </Button>
              {overflowBound.length > 0 ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <Button
                      variant="outline"
                      size="xs"
                      title={`${overflowBound.length} more quick action${overflowBound.length === 1 ? "" : "s"}`}
                    >
                      +{overflowBound.length}
                      <CaretDown size={9} />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content>
                    {overflowBound.map((action) => (
                      <DropdownMenu.Item
                        key={`${action.situationId}::${action.id}`}
                        onSelect={() => handleRunAction(action)}
                      >
                        <Sparkle size={11} />
                        {action.label}
                        <Text className="ml-auto pl-3 text-(--gray-10) text-[10px]">
                          {action.situationLabel}
                        </Text>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              ) : null}
            </Flex>
          ) : workstream.prUrl ? (
            <Button variant="outline" size="xs" onClick={handleOpenPr}>
              Open PR
            </Button>
          ) : (
            <Button variant="outline" size="xs" onClick={handleOpenTask}>
              Open task
            </Button>
          )}
          {taskCount > 1 ? (
            <Text className="text-(--gray-10) text-[11px]">
              {taskCount} tasks
            </Text>
          ) : null}
        </Flex>
      </Flex>
    </Box>
  );
}
