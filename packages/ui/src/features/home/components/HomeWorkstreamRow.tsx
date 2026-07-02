import {
  ChatCircle,
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
import { Box, Flex, Text } from "@radix-ui/themes";
import { SituationChip } from "./SituationChip";
import {
  AuthorAvatar,
  CiIndicator,
  type MetaItem,
  MetaList,
  StatusGlyph,
  WorkstreamOverflowMenu,
} from "./WorkstreamBits";

interface HomeWorkstreamRowProps {
  workstream: HomeWorkstream;
}

export function HomeWorkstreamRow({ workstream }: HomeWorkstreamRowProps) {
  const {
    pr,
    title,
    primarySid,
    accent,
    author,
    extraSituations,
    generating,
    needsPermission,
    quickActions,
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

  const meta: MetaItem[] = [];
  if (workstream.repoName) {
    meta.push({
      key: "repo",
      node: <span className="text-(--gray-11)">{workstream.repoName}</span>,
    });
  }
  if (workstream.branch) {
    meta.push({
      key: "branch",
      node: (
        <span className="inline-flex min-w-0 items-center gap-1">
          <GitBranch size={11} className="shrink-0" />
          <span className="max-w-[200px] truncate" title={workstream.branch}>
            {workstream.branch}
          </span>
        </span>
      ),
    });
  }
  if (pr) {
    meta.push({ key: "pr", node: <span>#{pr.number}</span> });
  }
  if (pr && pr.ciStatus !== "passing" && pr.ciStatus !== "none") {
    meta.push({
      key: "ci",
      node: <CiIndicator status={pr.ciStatus} showLabel />,
    });
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
  if (generating) {
    meta.push({
      key: "gen",
      node: (
        <span className="inline-flex items-center gap-1 text-(--accent-11)">
          <ChatCircle size={11} />
          Generating
        </span>
      ),
    });
  }
  if (quickActions.length > 0) {
    meta.push({
      key: "quick-actions",
      node: (
        <span
          className="inline-flex items-center gap-1 text-(--accent-11)"
          title={`Quick actions run: ${quickActions.join(", ")}`}
        >
          <Sparkle size={11} weight="fill" />
          {quickActions.slice(0, 2).join(", ")}
          {quickActions.length > 2 ? ` +${quickActions.length - 2}` : ""}
        </span>
      ),
    });
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
      className="group relative flex cursor-pointer items-center gap-3 border-(--gray-3) border-b py-2.5 pr-3 pl-4 transition-colors hover:bg-(--gray-2)"
      style={isSelected ? { backgroundColor: "var(--accent-a3)" } : undefined}
    >
      <span
        aria-hidden
        className="absolute top-0 bottom-0 left-0 w-[3px]"
        style={{ backgroundColor: accent.solid }}
      />

      <StatusGlyph sid={primarySid} size={32} />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="truncate font-medium text-[13px] text-gray-12"
            title={title}
          >
            {title}
          </span>
          {extraSituations.map((sid) => (
            <SituationChip key={sid} sid={sid} />
          ))}
        </div>
        <MetaList items={meta} />
      </div>

      <Flex
        align="center"
        className="shrink-0 gap-2.5 pl-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {author ? <AuthorAvatar login={author} /> : null}
        <Text className="w-[40px] shrink-0 text-right text-(--gray-9) text-[11px]">
          {formatRelativeTimeShort(workstream.lastActivityAt)}
        </Text>

        <div className="flex items-center gap-1">
          {primaryBound ? (
            <Button
              variant="primary"
              size="sm"
              disabled={isRunningAction}
              onClick={() => runAction(primaryBound)}
              title={`${primaryBound.situationLabel} → ${primaryBound.skillId}`}
            >
              {isRunningAction ? (
                <CircleNotch size={12} weight="bold" className="animate-spin" />
              ) : (
                <Sparkle size={12} weight="fill" />
              )}
              {primaryBound.label}
            </Button>
          ) : primaryIsPr ? (
            <Button variant="outline" size="sm" onClick={openPr}>
              <GitPullRequest size={12} />
              {author ? "Review PR" : "View PR"}
            </Button>
          ) : primaryIsTask ? (
            <Button variant="outline" size="sm" onClick={openTask}>
              Open task
            </Button>
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
              size="sm"
              runDisabled={isRunningAction}
            />
          ) : null}
        </div>
      </Flex>
    </Box>
  );
}
