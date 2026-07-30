import {
  ArrowSquareOutIcon,
  ChatCircleIcon,
  PackageIcon,
  SlackLogoIcon,
} from "@phosphor-icons/react";
import type { ResourceComment } from "@posthog/api-client/posthog-client";
import {
  OUTPUT_ARTIFACT_TYPES,
  parseRunArtifacts,
  type RunArtifact,
} from "@posthog/core/canvas/runArtifactSchemas";
import type { ThreadTimelineRow } from "@posthog/core/canvas/threadTimeline";
import type { CommentTarget } from "@posthog/core/comments/anchors";
import {
  Badge,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@posthog/quill";
import { readPrUrls } from "@posthog/shared";
import type {
  Task,
  TaskRun,
  TaskThreadMessage,
} from "@posthog/shared/domain-types";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import { useTaskRuns } from "@posthog/ui/features/canvas/hooks/useTaskRuns";
import { openPrInReview } from "@posthog/ui/features/code-review/openPrInReview";
import { usePrArtifact } from "@posthog/ui/features/git-interaction/usePrArtifact";
import { usePanelLayoutStore } from "@posthog/ui/features/panels/panelLayoutStore";
import { usePrComments } from "@posthog/ui/features/pr-review/usePrComments";
import { usePrReviewThreads } from "@posthog/ui/features/pr-review/usePrReviewThreads";
import { buildCommentThreads } from "@posthog/ui/features/sessions/components/commentViewTypes";
import { useCommentsForTargetsQuery } from "@posthog/ui/features/sessions/components/useComments";
import { FileIcon } from "@posthog/ui/primitives/FileIcon";
import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import { parseHttpsUrl, parseShareLink } from "@posthog/ui/utils/posthogLinks";
import { navigateToShareTarget } from "@posthog/ui/utils/shareLinks";
import { getPostHogUrl } from "@posthog/ui/utils/urls";
import { type ReactNode, useMemo, useState } from "react";

const EMPTY_COMMENTS: ResourceComment[] = [];

type ArtifactRow =
  | { kind: "pr"; key: string; url: string }
  | {
      kind: "canvas";
      key: string;
      name: string;
      url: string | null;
      /** The canvas row id, the stable comment target (never the name). */
      dashboardId: string | null;
    }
  | {
      kind: "file";
      key: string;
      artifactId: string | null;
      name: string;
      runId: string | null;
    }
  | { kind: "slack"; key: string; url: string };

/** The row kinds that can carry comments. */
type CommentSourceRow = Extract<ArtifactRow, { kind: "file" | "canvas" }>;

/** The canvas's stable row id, recovered from its share link. */
function canvasDashboardId(url: string | null): string | null {
  if (!url) return null;
  const parsed = parseHttpsUrl(url);
  const target = parsed ? parseShareLink(parsed.href) : null;
  return target?.kind === "canvas" ? target.dashboardId : null;
}

function openCanvasFromUrl(url: string | null): (() => void) | undefined {
  const parsed = url ? parseHttpsUrl(url) : null;
  const target = parsed ? parseShareLink(parsed.href) : null;
  if (!parsed || !target) return undefined;
  return () => {
    const currentPostHogUrl = getPostHogUrl("/");
    const currentPostHogOrigin = currentPostHogUrl
      ? parseHttpsUrl(currentPostHogUrl)?.origin
      : null;
    if (parsed.origin === currentPostHogOrigin) {
      navigateToShareTarget(target);
    } else {
      openExternalUrl(parsed.href);
    }
  };
}

/**
 * Every commentable resource this task produced. Artifacts and canvases share
 * the generic comments API, differing only by scope, so the pane can hold one
 * query over all of them.
 */
function commentTargets(rows: ArtifactRow[]): CommentTarget[] {
  const targets: CommentTarget[] = [];
  for (const row of rows) {
    if (row.kind === "file" && row.artifactId) {
      targets.push({ scope: "task_artifact", itemId: row.artifactId });
    } else if (row.kind === "canvas" && row.dashboardId) {
      targets.push({ scope: "desktop_canvas", itemId: row.dashboardId });
    }
  }
  return targets;
}

function readRunOutputs(run: TaskRun): RunArtifact[] {
  return parseRunArtifacts(
    (run as { artifacts?: unknown }).artifacts,
    OUTPUT_ARTIFACT_TYPES,
  );
}

function buildRows(
  task: Task,
  timeline: ThreadTimelineRow<TaskThreadMessage>[],
  runs: TaskRun[],
): ArtifactRow[] {
  const rows: ArtifactRow[] = [];
  const seenPrUrls = new Set<string>();

  const addPr = (url: string, key: string) => {
    if (seenPrUrls.has(url)) return;
    seenPrUrls.add(url);
    rows.push({ kind: "pr", key, url });
  };

  for (const row of timeline) {
    if (row.kind !== "artifact") continue;
    if (row.artifact.kind === "pr") {
      addPr(row.artifact.url, row.message.id);
    } else {
      const url = row.artifact.url;
      rows.push({
        kind: "canvas",
        key: row.message.id,
        name: row.artifact.name,
        url,
        dashboardId: canvasDashboardId(url),
      });
    }
  }

  const allRuns =
    runs.length > 0 ? runs : task.latest_run ? [task.latest_run] : [];

  // Re-uploading a file replaces it rather than adding a second one: agents
  // revise a deliverable and upload it again under the same name, so keeping
  // every copy would bury the current one under its own drafts.
  const newestByName = new Map<string, { file: RunArtifact; runId: string }>();
  for (const run of allRuns) {
    for (const outputPr of readPrUrls(run.output)) {
      addPr(outputPr, `output-pr:${outputPr}`);
    }
    for (const file of readRunOutputs(run)) {
      if (!file.name) continue;
      const previous = newestByName.get(file.name);
      const isNewer =
        !previous ||
        (file.uploaded_at ?? "") >= (previous.file.uploaded_at ?? "");
      if (isNewer) newestByName.set(file.name, { file, runId: run.id });
    }
  }
  for (const [name, { file, runId }] of newestByName) {
    rows.push({
      kind: "file",
      key: `file:${file.id ?? file.storage_path ?? name}`,
      artifactId: file.id ?? null,
      name,
      runId,
    });
  }

  const slackUrl = task.latest_run?.state?.slack_thread_url;
  if (typeof slackUrl === "string" && slackUrl) {
    rows.push({ kind: "slack", key: "slack-thread", url: slackUrl });
  }

  return rows;
}

function ArtifactListRow({
  icon,
  title,
  detail,
  external,
  onOpen,
  onOpenExternal,
  onHoverStart,
}: {
  icon: ReactNode;
  title: string;
  detail?: ReactNode;
  external?: boolean;
  onOpen?: () => void;
  /** Renders a trailing button that leaves the app instead of opening the
   *  artifact in place. Absent when there is nowhere safe to send the user. */
  onOpenExternal?: () => void;
  onHoverStart?: () => void;
}) {
  return (
    // overflow-hidden so each half's hover fill is clipped to the row's radius.
    <div className="flex w-full items-center overflow-hidden rounded-md border border-border bg-muted text-[13px]">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        onPointerEnter={onHoverStart}
        onFocus={onHoverStart}
        className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left transition-colors enabled:hover:bg-gray-3"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {detail && (
          <span className="shrink-0 text-muted-foreground">{detail}</span>
        )}
        {external && (
          <ArrowSquareOutIcon size={12} className="shrink-0 text-gray-9" />
        )}
      </button>
      {onOpenExternal && (
        <button
          type="button"
          onClick={onOpenExternal}
          aria-label={`Open ${title} externally`}
          className="flex shrink-0 items-center self-stretch border-border border-l px-2 text-muted-foreground transition-colors hover:bg-gray-3 hover:text-foreground"
        >
          <ArrowSquareOutIcon size={12} />
        </button>
      )}
    </div>
  );
}

function PrRow({
  url,
  openInPlaceTaskId,
}: {
  url: string;
  openInPlaceTaskId?: string;
}) {
  const { safeUrl, title, stateLabel, Icon, iconColor } = usePrArtifact(url);

  const [countsWanted, setCountsWanted] = useState(false);
  const comments = usePrComments(countsWanted ? safeUrl : null);
  const threads = usePrReviewThreads(countsWanted ? safeUrl : null);

  const commentCount =
    (comments.data?.length ?? 0) +
    (threads.data ?? []).reduce(
      (sum, thread) => sum + thread.comments.length,
      0,
    );
  const detailParts = [
    stateLabel,
    comments.data || threads.data
      ? `${commentCount} ${commentCount === 1 ? "comment" : "comments"}`
      : null,
  ].filter(Boolean);

  return (
    <ArtifactListRow
      icon={
        <Icon
          size={14}
          weight="bold"
          className="shrink-0"
          style={{ color: iconColor }}
        />
      }
      title={title}
      detail={detailParts.join(" · ") || null}
      onHoverStart={() => setCountsWanted(true)}
      onOpen={
        safeUrl
          ? () =>
              openInPlaceTaskId
                ? openPrInReview(openInPlaceTaskId, safeUrl)
                : openExternalUrl(safeUrl)
          : undefined
      }
      onOpenExternal={safeUrl ? () => openExternalUrl(safeUrl) : undefined}
    />
  );
}

function CanvasRow({
  name,
  url,
  commentCount,
}: {
  name: string;
  url: string | null;
  commentCount: number;
}) {
  return (
    <ArtifactListRow
      icon={iconForTemplate("", { size: 14, className: "text-violet-9" })}
      title={name}
      detail={
        commentCount > 0 ? (
          <Badge>
            <ChatCircleIcon />
            {commentCount}
          </Badge>
        ) : (
          "Canvas"
        )
      }
      onOpen={openCanvasFromUrl(url)}
    />
  );
}

/**
 * Every open thread across the task's artifacts and canvases, in one list.
 * Each row names the resource it came from, and opening one jumps straight to
 * that thread inside the resource.
 */
function TaskCommentsSection({
  taskId,
  rows,
  comments,
}: {
  taskId: string;
  rows: ArtifactRow[];
  comments: ResourceComment[];
}) {
  const openArtifactTab = usePanelLayoutStore((state) => state.openArtifactTab);

  const sourced = useMemo(() => {
    const sources = new Map<string, CommentSourceRow>();
    for (const row of rows) {
      if (row.kind === "file" && row.artifactId)
        sources.set(row.artifactId, row);
      else if (row.kind === "canvas" && row.dashboardId)
        sources.set(row.dashboardId, row);
    }
    // One shared thread model, then attach each thread's originating resource.
    // Resolved threads drop out here, as they do on the artifact surfaces.
    return buildCommentThreads(comments)
      .flatMap((thread) => {
        if (thread.resolved) return [];
        const row = thread.root.item_id
          ? sources.get(thread.root.item_id)
          : undefined;
        return row ? [{ thread, row }] : [];
      })
      .sort((a, b) =>
        (
          b.thread.replies.at(-1)?.created_at ?? b.thread.root.created_at
        ).localeCompare(
          a.thread.replies.at(-1)?.created_at ?? a.thread.root.created_at,
        ),
      );
  }, [comments, rows]);

  if (sourced.length === 0) return null;

  return (
    <section aria-label="Artifact comments" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 px-0.5 pt-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        <ChatCircleIcon size={12} />
        Comments
        <Badge>{sourced.length}</Badge>
      </div>
      {sourced.map(({ thread, row }) => {
        const canOpen =
          row.kind === "file"
            ? !!row.runId && !!row.artifactId
            : !!openCanvasFromUrl(row.url);
        return (
          <button
            key={thread.root.id}
            type="button"
            disabled={!canOpen}
            onClick={() => {
              if (row.kind === "canvas") {
                // Canvas comment surfaces land with the canvas work; until then
                // this opens the canvas itself rather than a dead deep link.
                openCanvasFromUrl(row.url)?.();
                return;
              }
              if (!row.runId || !row.artifactId) return;
              openArtifactTab(taskId, {
                runId: row.runId,
                artifactId: row.artifactId,
                name: row.name,
                commentId: thread.root.id,
              });
            }}
            className="flex w-full flex-col gap-1 rounded-md border border-border bg-muted px-2.5 py-2 text-left text-[13px] transition-colors enabled:hover:bg-gray-3"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
              {row.kind === "file" ? (
                <FileIcon filename={row.name} size={12} />
              ) : (
                iconForTemplate("", { size: 12, className: "text-violet-9" })
              )}
              <span className="min-w-0 truncate">{row.name}</span>
              {thread.replies.length > 0 && (
                <span className="shrink-0">
                  · {thread.replies.length}{" "}
                  {thread.replies.length === 1 ? "reply" : "replies"}
                </span>
              )}
            </span>
            <span className="line-clamp-2 break-words">
              {thread.root.content ?? ""}
            </span>
          </button>
        );
      })}
    </section>
  );
}

function FileRow({
  taskId,
  runId,
  artifactId,
  name,
  commentCount,
}: {
  taskId: string;
  runId: string | null;
  artifactId: string | null;
  name: string;
  /** Supplied by the pane's single comments query so each row doesn't fetch. */
  commentCount: number;
}) {
  const openArtifactTab = usePanelLayoutStore((state) => state.openArtifactTab);
  const canOpen = !!runId && !!artifactId;
  const onOpen = canOpen
    ? () => {
        openArtifactTab(taskId, {
          runId: runId as string,
          artifactId: artifactId as string,
          name,
        });
      }
    : undefined;
  return (
    <ArtifactListRow
      icon={<FileIcon filename={name} size={14} />}
      title={name}
      detail={
        <Badge>
          <ChatCircleIcon />
          {commentCount}
        </Badge>
      }
      onOpen={onOpen}
    />
  );
}

export function TaskArtifactsList({
  task,
  timeline,
  canOpenInPlace,
}: {
  task: Task;
  timeline: ThreadTimelineRow<TaskThreadMessage>[];
  /** See `ActivityTimeline` — without the task's own view alongside, a PR has to
   *  open externally rather than into a review pane nobody is showing. */
  canOpenInPlace?: boolean;
}) {
  const { runs } = useTaskRuns(task.id);
  const rows = useMemo(
    () => buildRows(task, timeline, runs),
    [task, timeline, runs],
  );
  // One query for the whole pane: row badges and the comment list read the same
  // result, so N resources cost one request rather than one poll each.
  const targets = useMemo(() => commentTargets(rows), [rows]);
  const commentsQuery = useCommentsForTargetsQuery(targets);
  const comments = commentsQuery.data ?? EMPTY_COMMENTS;
  const rootCountByItem = useMemo(() => {
    const counts = new Map<string, number>();
    for (const comment of comments) {
      if (comment.source_comment || !comment.item_id) continue;
      counts.set(comment.item_id, (counts.get(comment.item_id) ?? 0) + 1);
    }
    return counts;
  }, [comments]);

  if (rows.length === 0) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PackageIcon size={18} />
          </EmptyMedia>
          <EmptyTitle>No artifacts yet</EmptyTitle>
          <EmptyDescription>
            Pull requests, canvases, and files produced while working on this
            task show up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 p-2">
      {rows.map((row) =>
        row.kind === "pr" ? (
          <PrRow
            key={row.key}
            url={row.url}
            openInPlaceTaskId={canOpenInPlace ? task.id : undefined}
          />
        ) : row.kind === "canvas" ? (
          <CanvasRow
            key={row.key}
            name={row.name}
            url={row.url}
            commentCount={
              row.dashboardId ? (rootCountByItem.get(row.dashboardId) ?? 0) : 0
            }
          />
        ) : row.kind === "file" ? (
          <FileRow
            key={row.key}
            taskId={task.id}
            runId={row.runId}
            artifactId={row.artifactId}
            name={row.name}
            commentCount={
              row.artifactId ? (rootCountByItem.get(row.artifactId) ?? 0) : 0
            }
          />
        ) : (
          <ArtifactListRow
            key={row.key}
            icon={<SlackLogoIcon size={14} className="shrink-0 text-gray-11" />}
            title="Slack thread"
            detail="External"
            external
            onOpen={() => openExternalUrl(row.url)}
          />
        ),
      )}
      <TaskCommentsSection taskId={task.id} rows={rows} comments={comments} />
    </div>
  );
}
