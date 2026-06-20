import {
  ArrowSquareOut,
  CaretDown,
  CaretRight,
  ChatCircle,
  CheckCircle,
  CircleDashed,
  GitBranch,
  GitPullRequest,
  Sparkle,
  Spinner,
  Warning,
  X,
  XCircle,
} from "@phosphor-icons/react";
import type { PrSnapshot } from "@posthog/core/home/prSnapshot";
import type {
  HomeWorkstream,
  HomeWorkstreamTask,
} from "@posthog/core/home/schemas";
import { Badge, Button } from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import type { TaskRunStatus } from "@posthog/shared/domain-types";
import {
  type BoundAction,
  useBoundActions,
} from "@posthog/ui/features/home/hooks/useBoundActions";
import { useRunWorkstreamAction } from "@posthog/ui/features/home/hooks/useRunWorkstreamAction";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { openTask } from "@posthog/ui/router/useOpenTask";
import { openUrlInBrowser } from "@posthog/ui/utils/browser";
import { Box, DropdownMenu, Flex, Text } from "@radix-ui/themes";
import { SituationChip } from "./SituationChip";
import { CiIndicator } from "./WorkstreamBits";

interface Props {
  workstream: HomeWorkstream;
  onClose: () => void;
}

export function HomeWorkstreamDetailPanel({ workstream, onClose }: Props) {
  const { data: allTasks = [] } = useTasks();
  const boundActions = useBoundActions(workstream);
  const { run: runAction, isPending: isRunningAction } =
    useRunWorkstreamAction();

  const pr = workstream.pr;
  const headTask = workstream.tasks[0];
  const title =
    pr?.title ?? headTask?.title ?? workstream.branch ?? "Workstream";

  function handleOpenTask(task: HomeWorkstreamTask) {
    const found = allTasks.find((t) => t.id === task.id);
    if (found) void openTask(found);
  }

  function handleOpenPr() {
    if (workstream.prUrl) void openUrlInBrowser(workstream.prUrl);
  }

  const primaryAction = boundActions[0] ?? null;
  const overflowActions = boundActions.slice(1);

  return (
    <Flex
      direction="column"
      className="h-full min-h-0 w-full min-w-0 overflow-hidden bg-(--color-panel-solid)"
    >
      {/* Header */}
      <Flex
        align="start"
        justify="between"
        gap="2"
        className="border-(--gray-4) border-b px-4 py-3"
      >
        <Flex direction="column" gap="1" className="min-w-0 flex-1">
          <Text
            className="line-clamp-2 break-words font-semibold text-[13px] text-gray-12 leading-snug"
            title={title}
          >
            {title}
          </Text>
          <Flex
            align="center"
            gap="2"
            wrap="wrap"
            className="text-(--gray-10) text-[11px]"
          >
            {workstream.repoName ? <Text>{workstream.repoName}</Text> : null}
            {workstream.branch ? (
              <Flex align="center" gap="1" className="min-w-0">
                <GitBranch size={10} />
                <span className="truncate" title={workstream.branch}>
                  {workstream.branch}
                </span>
              </Flex>
            ) : null}
            {pr ? <Text title={`PR #${pr.number}`}>#{pr.number}</Text> : null}
            <Text>{formatRelativeTimeShort(workstream.lastActivityAt)}</Text>
          </Flex>
        </Flex>
        <Button size="xs" variant="link-muted" onClick={onClose} title="Close">
          <X size={12} />
        </Button>
      </Flex>

      <div className="scrollbar-overlay-y min-h-0 flex-1 overflow-x-hidden">
        <Flex direction="column" gap="4" className="min-w-0 px-4 py-4">
          {workstream.situations.length > 0 ? (
            <Section title="Situations">
              <Flex gap="1" wrap="wrap">
                {workstream.situations.map((sid) => (
                  <SituationChip key={sid} sid={sid} />
                ))}
              </Flex>
            </Section>
          ) : null}

          {pr ? <PrBlock pr={pr} onOpen={handleOpenPr} /> : null}

          {boundActions.length > 0 ? (
            <Section title="Quick actions">
              <Flex gap="1.5" wrap="wrap">
                {primaryAction ? (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={isRunningAction}
                    onClick={() => runAction(primaryAction, workstream)}
                    title={`${primaryAction.situationLabel} → ${primaryAction.skillId}`}
                  >
                    {isRunningAction ? (
                      <Spinner size={12} className="animate-spin" />
                    ) : (
                      <Sparkle size={12} />
                    )}
                    {primaryAction.label}
                  </Button>
                ) : null}
                {overflowActions.length > 0 ? (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      <Button variant="outline" size="sm">
                        +{overflowActions.length}
                        <CaretDown size={10} />
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content>
                      {overflowActions.map((action: BoundAction) => (
                        <DropdownMenu.Item
                          key={`${action.situationId}::${action.id}`}
                          disabled={isRunningAction}
                          onSelect={() => runAction(action, workstream)}
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
            </Section>
          ) : null}

          <Section
            title={`Tasks (${workstream.tasks.length})`}
            subtitle={
              workstream.tasks.length === 0
                ? "No tasks attached to this workstream"
                : undefined
            }
          >
            <Flex direction="column" gap="1">
              {workstream.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onClick={() => handleOpenTask(task)}
                />
              ))}
            </Flex>
          </Section>
        </Flex>
      </div>

      {/* Footer links */}
      {workstream.prUrl ? (
        <Box className="border-(--gray-4) border-t px-4 py-2">
          <Button
            variant="link-muted"
            size="sm"
            onClick={handleOpenPr}
            className="w-full justify-center"
          >
            <GitPullRequest size={12} />
            Open PR in browser
            <ArrowSquareOut size={10} />
          </Button>
        </Box>
      ) : null}
    </Flex>
  );
}

interface SectionProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

function Section({ title, subtitle, children }: SectionProps) {
  return (
    <Flex direction="column" gap="2">
      <Flex direction="column" gap="0">
        <Text className="font-semibold text-[10px] text-gray-11 uppercase tracking-wider">
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-[11px] text-gray-10">{subtitle}</Text>
        ) : null}
      </Flex>
      {children}
    </Flex>
  );
}

function PrBlock({ pr, onOpen }: { pr: PrSnapshot; onOpen: () => void }) {
  return (
    <Section title="Pull request">
      <Flex
        direction="column"
        gap="2"
        className="rounded-md border border-(--gray-5) bg-(--gray-2) px-3 py-2.5"
      >
        <Flex align="center" justify="between" gap="2">
          <PrStatePill pr={pr} />
          <CiIndicator status={pr.ciStatus} showLabel />
        </Flex>
        {pr.reviewDecision === "approved" ? (
          <Flex
            align="center"
            gap="1"
            className="text-(--green-11) text-[11px]"
          >
            <CheckCircle size={11} weight="fill" />
            <span>Approved</span>
          </Flex>
        ) : null}
        {pr.reviewDecision === "changes_requested" ? (
          <Flex
            align="center"
            gap="1"
            className="text-(--amber-11) text-[11px]"
          >
            <Warning size={11} weight="fill" />
            <span>Changes requested</span>
          </Flex>
        ) : null}
        {pr.unresolvedThreads > 0 ? (
          <Flex align="center" gap="1" className="text-[11px] text-gray-11">
            <ChatCircle size={11} />
            <span>
              {pr.unresolvedThreads} unresolved review thread
              {pr.unresolvedThreads === 1 ? "" : "s"}
            </span>
          </Flex>
        ) : null}
        {pr.author && !pr.isCurrentUserAuthor ? (
          <Text className="text-[11px] text-gray-11">by @{pr.author}</Text>
        ) : null}
        <Button
          variant="link-muted"
          size="xs"
          onClick={onOpen}
          className="self-start"
        >
          <ArrowSquareOut size={10} />
          Open PR
        </Button>
      </Flex>
    </Section>
  );
}

function PrStatePill({ pr }: { pr: PrSnapshot }) {
  if (pr.state === "merged") return <Badge variant="info">Merged</Badge>;
  if (pr.state === "draft") return <Badge variant="default">Draft</Badge>;
  if (pr.state === "closed") return <Badge variant="default">Closed</Badge>;
  return <Badge variant="success">Open</Badge>;
}

function TaskRow({
  task,
  onClick,
}: {
  task: HomeWorkstreamTask;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-md border border-(--gray-5) bg-(--gray-1) px-2.5 py-1.5 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2)"
    >
      <TaskStatusIcon
        status={task.status ?? undefined}
        isGenerating={task.isGenerating}
      />
      <Text className="min-w-0 flex-1 truncate text-[12px] text-gray-12">
        {task.title}
      </Text>
      {task.quickAction ? (
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-(--accent-a3) px-1.5 py-0.5 text-(--accent-11) text-[10px]"
          title={`Started via quick action: ${task.quickAction}`}
        >
          <Sparkle size={9} weight="fill" />
          {task.quickAction}
        </span>
      ) : null}
      {task.needsPermission ? (
        <Badge variant="warning" title="Awaiting permission">
          !
        </Badge>
      ) : null}
      <CaretRight size={11} className="shrink-0 text-(--gray-10)" />
    </button>
  );
}

function TaskStatusIcon({
  status,
  isGenerating,
}: {
  status: TaskRunStatus | undefined;
  isGenerating: boolean;
}) {
  if (isGenerating || status === "in_progress" || status === "queued") {
    return (
      <Spinner size={11} className="shrink-0 animate-spin text-(--accent-11)" />
    );
  }
  if (status === "completed") {
    return (
      <CheckCircle
        size={11}
        weight="fill"
        className="shrink-0 text-(--green-9)"
      />
    );
  }
  if (status === "failed") {
    return (
      <XCircle size={11} weight="fill" className="shrink-0 text-(--red-9)" />
    );
  }
  return <CircleDashed size={11} className="shrink-0 text-(--gray-10)" />;
}
