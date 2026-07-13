import {
  CircleNotch,
  GitBranch,
  GitPullRequest,
  Sparkle,
  Warning,
} from "@phosphor-icons/react";
import type { HomeWorkstream } from "@posthog/core/home/schemas";
import { Button } from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import { useWorkstreamPresentation } from "@posthog/ui/features/home/hooks/useWorkstreamPresentation";
import { useHomeUiStore } from "@posthog/ui/features/home/stores/homeUiStore";
import { SITUATION_VISUAL } from "@posthog/ui/features/home/utils/situationDisplay";
import { Box, Flex, Text } from "@radix-ui/themes";
import { SituationChip } from "./SituationChip";
import {
  AuthorAvatar,
  CiIndicator,
  type MetaItem,
  MetaList,
  WorkstreamOverflowMenu,
} from "./WorkstreamBits";

interface HomeWorkstreamCardProps {
  workstream: HomeWorkstream;
}

export function HomeWorkstreamCard({ workstream }: HomeWorkstreamCardProps) {
  const {
    pr,
    title,
    primarySid,
    accent,
    author,
    extraSituations,
    needsPermission,
    primaryBound,
    restBound,
    primaryIsPr,
    primaryIsTask,
    showPrInMenu,
    showTaskInMenu,
    canArchive,
    hasMenu,
    runAction,
    isRunningAction,
    openTask,
    openPr,
    archive,
  } = useWorkstreamPresentation(workstream);
  const setSelectedWorkstreamId = useHomeUiStore(
    (s) => s.setSelectedWorkstreamId,
  );
  const isSelected = useHomeUiStore(
    (s) => s.selectedWorkstreamId === workstream.id,
  );

  const taskCount = workstream.tasks.length;
  const primary = SITUATION_VISUAL[primarySid];
  const PrimaryIcon = primary.Icon;

  const meta: MetaItem[] = [];
  if (workstream.branch) {
    meta.push({
      key: "branch",
      node: (
        <span className="inline-flex min-w-0 items-center gap-1">
          <GitBranch size={11} className="shrink-0" />
          <span className="max-w-[150px] truncate" title={workstream.branch}>
            {workstream.branch}
          </span>
        </span>
      ),
    });
  }
  if (pr) {
    meta.push({ key: "pr", node: <span>#{pr.number}</span> });
  }
  if (needsPermission) {
    meta.push({
      key: "perm",
      node: (
        <span className="inline-flex items-center gap-1 text-(--amber-11)">
          <Warning size={11} weight="fill" />
          Awaiting permission
        </span>
      ),
    });
  }
  meta.push({
    key: "time",
    node: <span>{formatRelativeTimeShort(workstream.lastActivityAt)}</span>,
  });

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
      className="group hover:-translate-y-px relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-lg border border-(--gray-4) bg-(--color-panel-solid) px-3 pt-3 pb-2.5 transition-all hover:border-(--gray-7) hover:shadow-md"
      style={
        isSelected
          ? {
              borderColor: "var(--accent-8)",
              boxShadow: "0 0 0 1px var(--accent-8)",
            }
          : undefined
      }
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ backgroundColor: accent.solid }}
      />

      <div className="flex items-center justify-between gap-2">
        <span
          className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-[11px]"
          style={{ color: accent.fg }}
          title={primary.description}
        >
          <PrimaryIcon size={13} weight="bold" className="shrink-0" />
          <span className="truncate">{primary.label}</span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {author ? <AuthorAvatar login={author} /> : null}
          {pr ? <CiIndicator status={pr.ciStatus} /> : null}
        </div>
      </div>

      <span
        className="line-clamp-2 font-medium text-[13px] text-gray-12 leading-snug"
        title={title}
      >
        {title}
      </span>

      {extraSituations.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {extraSituations.map((sid) => (
            <SituationChip key={sid} sid={sid} />
          ))}
        </div>
      ) : null}

      <MetaList items={meta} className="mt-0.5" />

      <Flex
        align="center"
        justify="between"
        className="mt-1.5 gap-2 border-(--gray-3) border-t pt-2.5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {primaryBound ? (
          <Button
            variant="primary"
            size="xs"
            disabled={isRunningAction}
            onClick={() => runAction(primaryBound)}
            title={`${primaryBound.situationLabel} → ${primaryBound.skillId}`}
          >
            {isRunningAction ? (
              <CircleNotch size={11} weight="bold" className="animate-spin" />
            ) : (
              <Sparkle size={11} weight="fill" />
            )}
            {primaryBound.label}
          </Button>
        ) : primaryIsPr ? (
          <Button variant="outline" size="xs" onClick={openPr}>
            <GitPullRequest size={11} />
            {author ? "Review PR" : "View PR"}
          </Button>
        ) : primaryIsTask ? (
          <Button variant="outline" size="xs" onClick={openTask}>
            Open task
          </Button>
        ) : (
          <span />
        )}

        <div className="flex shrink-0 items-center gap-2">
          {taskCount > 1 ? (
            <Text className="text-(--gray-10) text-[11px]">
              {taskCount} tasks
            </Text>
          ) : null}
          {hasMenu ? (
            <WorkstreamOverflowMenu
              restBound={restBound}
              showPrInMenu={showPrInMenu}
              showTaskInMenu={showTaskInMenu}
              showArchive={canArchive}
              onRun={runAction}
              onOpenPr={openPr}
              onOpenTask={openTask}
              onArchive={archive}
              size="xs"
              runDisabled={isRunningAction}
            />
          ) : null}
        </div>
      </Flex>
    </Box>
  );
}
