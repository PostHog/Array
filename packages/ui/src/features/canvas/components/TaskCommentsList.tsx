import { CaretDownIcon, ChatCircleIcon } from "@phosphor-icons/react";
import type { ResourceComment } from "@posthog/api-client/posthog-client";
import type { ThreadTimelineRow } from "@posthog/core/canvas/threadTimeline";
import { commentTargetKey } from "@posthog/core/comments/anchors";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Spinner,
} from "@posthog/quill";
import type {
  Task,
  TaskThreadMessage,
  UserBasic,
} from "@posthog/shared/domain-types";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import {
  type ArtifactRow,
  buildRows,
  type CommentSourceRow,
  commentTargets,
  openCanvasFromUrl,
  targetForRow,
} from "@posthog/ui/features/canvas/components/taskArtifactRows";
import { useOrgMembers } from "@posthog/ui/features/canvas/hooks/useOrgMembers";
import { useTaskRuns } from "@posthog/ui/features/canvas/hooks/useTaskRuns";
import { usePanelLayoutStore } from "@posthog/ui/features/panels/panelLayoutStore";
import { useCommentNavigationStore } from "@posthog/ui/features/sessions/commentNavigationStore";
import { CommentThreadCard } from "@posthog/ui/features/sessions/components/CommentThreadCard";
import {
  buildCommentThreads,
  type HighlightResolution,
  readCommentContext,
  type SourcedCommentThread,
} from "@posthog/ui/features/sessions/components/commentViewTypes";
import {
  useCommentsForTargetsQuery,
  useCreateComment,
  useSetCommentResolved,
} from "@posthog/ui/features/sessions/components/useComments";
import { FileIcon } from "@posthog/ui/primitives/FileIcon";
import { useEffect, useMemo, useRef, useState } from "react";

const EMPTY_COMMENTS: ResourceComment[] = [];
/** The whole task's threads in one request; slower than a single artifact's own
 *  poll because this one fans out across every resource. */
const POLL_INTERVAL_MS = 15_000;
const PULSE_MS = 1_200;

type CommentFilter = "open" | "resolved";

/** The commentable rows, keyed by the resource id their comments carry. */
function commentSourceRows(rows: ArtifactRow[]): Map<string, CommentSourceRow> {
  const sources = new Map<string, CommentSourceRow>();
  for (const row of rows) {
    if (row.kind !== "file" && row.kind !== "canvas") continue;
    const target = targetForRow(row);
    if (target) sources.set(target.itemId, row);
  }
  return sources;
}

/** Every thread the task has, tagged with the resource it belongs to. */
function sourcedThreads(
  comments: ResourceComment[],
  sources: Map<string, CommentSourceRow>,
): SourcedCommentThread[] {
  return buildCommentThreads(comments)
    .flatMap((thread) => {
      const row = thread.root.item_id
        ? sources.get(thread.root.item_id)
        : undefined;
      const target = row ? targetForRow(row) : null;
      if (!row || !target) return [];
      return [
        {
          ...thread,
          source: {
            target,
            name: row.name,
            ...(row.kind === "file" && row.runId ? { runId: row.runId } : {}),
          },
        },
      ];
    })
    .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
}

function lastActivity(thread: SourcedCommentThread): string {
  return thread.replies.at(-1)?.created_at ?? thread.root.created_at;
}

function ThreadSourceLabel({
  thread,
  isCanvas,
}: {
  thread: SourcedCommentThread;
  isCanvas: boolean;
}) {
  return (
    <span className="mb-1 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
      {isCanvas ? (
        iconForTemplate("", { size: 12, className: "text-violet-9" })
      ) : (
        <FileIcon filename={thread.source.name} size={12} />
      )}
      <span className="min-w-0 truncate">{thread.source.name}</span>
      {thread.replies.length > 0 && (
        <span className="shrink-0">
          · {thread.replies.length}{" "}
          {thread.replies.length === 1 ? "reply" : "replies"}
        </span>
      )}
    </span>
  );
}

/**
 * One row of the list. Its own component so it can hold the mutations for its
 * thread's resource — the list spans several, and each needs its own target.
 */
function TaskCommentRow({
  thread,
  members,
  selected,
  pulsing,
  resolution,
  onOpen,
}: {
  thread: SourcedCommentThread;
  members: UserBasic[];
  selected: boolean;
  pulsing: boolean;
  resolution?: HighlightResolution;
  onOpen: () => void;
}) {
  const target = thread.source.target;
  const createComment = useCreateComment(target);
  const setResolved = useSetCommentResolved(target);

  return (
    <CommentThreadCard
      root={thread.root}
      replies={thread.replies}
      selected={selected}
      pulsing={pulsing}
      resolved={thread.resolved}
      members={members}
      resolution={resolution}
      busy={createComment.isPending || setResolved.isPending}
      source={
        <ThreadSourceLabel
          thread={thread}
          isCanvas={target.scope === "desktop_canvas"}
        />
      }
      onSelect={onOpen}
      onReply={(content, mentions) => {
        const rootContext = readCommentContext(thread.root);
        createComment.mutate({
          content,
          sourceCommentId: thread.root.id,
          context: rootContext ?? { anchor: { kind: "document" } },
          mentions,
        });
      }}
      onResolve={(resolved) =>
        setResolved.mutate({ root: thread.root, resolved })
      }
    />
  );
}

/**
 * Every comment thread across the task's artifacts and canvases. Selecting one
 * opens the resource it belongs to and locates its anchor there, which is why
 * the artifact surfaces carry no thread list of their own.
 */
export function TaskCommentsList({
  task,
  timeline,
}: {
  task: Task;
  timeline: ThreadTimelineRow<TaskThreadMessage>[];
}) {
  const { runs } = useTaskRuns(task.id);
  const { members } = useOrgMembers();
  const openArtifactTab = usePanelLayoutStore((state) => state.openArtifactTab);
  const requestCommentFocus = useCommentNavigationStore(
    (state) => state.requestCommentFocus,
  );
  const focus = useCommentNavigationStore(
    (state) => state.focusByTask[task.id],
  );
  const resolutionsByTarget = useCommentNavigationStore(
    (state) => state.resolutionsByTarget,
  );
  const [filter, setFilter] = useState<CommentFilter>("open");
  const [pulseThreadId, setPulseThreadId] = useState<string | null>(null);

  const rows = useMemo(
    () => buildRows(task, timeline, runs),
    [task, timeline, runs],
  );
  const targets = useMemo(() => commentTargets(rows), [rows]);
  const commentsQuery = useCommentsForTargetsQuery(targets, {
    live: true,
    intervalMs: POLL_INTERVAL_MS,
  });
  const comments = commentsQuery.data ?? EMPTY_COMMENTS;
  const sources = useMemo(() => commentSourceRows(rows), [rows]);
  const threads = useMemo(
    () => sourcedThreads(comments, sources),
    [comments, sources],
  );
  const openCount = threads.filter((thread) => !thread.resolved).length;
  const resolvedCount = threads.length - openCount;
  const visibleThreads = threads.filter(
    (thread) => thread.resolved === (filter === "resolved"),
  );

  // A thread picked on the artifact itself has to surface here, even when the
  // filter is hiding it, so follow the focus request into the right filter.
  // Each request is honoured once, by nonce: resolving the focused thread later
  // must not drag the filter along with it.
  const focusedThreadId = focus?.threadId ?? null;
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || handledNonceRef.current === focus.nonce) return;
    const resolved = threads.find(
      (thread) => thread.root.id === focus.threadId,
    )?.resolved;
    // The thread may still be loading, so wait rather than guess its filter.
    if (resolved === undefined) return;
    handledNonceRef.current = focus.nonce;
    setFilter(resolved ? "resolved" : "open");
    setPulseThreadId(focus.threadId);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = setTimeout(() => setPulseThreadId(null), PULSE_MS);
    requestAnimationFrame(() => {
      document
        .querySelector(
          `[data-comment-thread-id="${CSS.escape(focus.threadId)}"]`,
        )
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [focus, threads]);
  useEffect(
    () => () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    },
    [],
  );

  const openThread = (thread: SourcedCommentThread) => {
    const target = thread.source.target;
    if (target.scope === "desktop_canvas") {
      // Canvas comment surfaces land with the canvas work; until then this
      // opens the canvas itself rather than a dead deep link.
      const row = sources.get(target.itemId);
      if (row?.kind === "canvas") openCanvasFromUrl(row.url)?.();
      return;
    }
    if (!thread.source.runId) return;
    openArtifactTab(task.id, {
      runId: thread.source.runId,
      artifactId: target.itemId,
      name: thread.source.name,
    });
    requestCommentFocus(task.id, target, thread.root.id);
  };

  return (
    // The tab body is the pane's scroller, so this is a plain column with a
    // header that sticks while the threads scroll under it.
    <div className="flex flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-gray-1 px-2 py-2">
        <div className="flex items-center gap-2 font-medium text-sm">
          Comments
          {threads.length > 0 && <Badge>{visibleThreads.length}</Badge>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="sm" aria-label="Filter comments">
                {filter === "open" ? "Open" : "Resolved"}
                <CaretDownIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end" sideOffset={6}>
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={(value) => setFilter(value as CommentFilter)}
            >
              <DropdownMenuRadioItem value="open">
                Open ({openCount})
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="resolved">
                Resolved ({resolvedCount})
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="space-y-2 p-2 pt-0">
        {commentsQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : visibleThreads.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChatCircleIcon />
              </EmptyMedia>
              <EmptyTitle>
                No {filter === "open" ? "open" : "resolved"} comments
              </EmptyTitle>
              <EmptyDescription>
                {filter === "open"
                  ? "Open an artifact and select text, or click an image, to start a thread."
                  : "Resolved threads will appear here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          visibleThreads.map((thread) => (
            <TaskCommentRow
              key={thread.root.id}
              thread={thread}
              members={members}
              selected={thread.root.id === focusedThreadId}
              pulsing={thread.root.id === pulseThreadId}
              resolution={resolutionsByTarget[
                commentTargetKey(thread.source.target)
              ]?.get(thread.root.id)}
              onOpen={() => openThread(thread)}
            />
          ))
        )}
      </div>
    </div>
  );
}
