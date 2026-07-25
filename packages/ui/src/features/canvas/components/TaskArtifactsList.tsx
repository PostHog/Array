import {
  ArrowSquareOutIcon,
  ClipboardTextIcon,
  PackageIcon,
  SlackLogoIcon,
} from "@phosphor-icons/react";
import {
  parseRunPlans,
  type RunArtifact,
} from "@posthog/core/canvas/runArtifactSchemas";
import type { ThreadTimelineRow } from "@posthog/core/canvas/threadTimeline";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@posthog/quill";
import type {
  Task,
  TaskRun,
  TaskThreadMessage,
} from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import { useTaskRuns } from "@posthog/ui/features/canvas/hooks/useTaskRuns";
import { useReviewNavigationStore } from "@posthog/ui/features/code-review/reviewNavigationStore";
import { usePrArtifact } from "@posthog/ui/features/git-interaction/usePrArtifact";
import { usePrComments } from "@posthog/ui/features/pr-review/usePrComments";
import { usePrReviewThreads } from "@posthog/ui/features/pr-review/usePrReviewThreads";
import { toast } from "@posthog/ui/primitives/toast";
import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import { parseHttpsUrl, parseShareLink } from "@posthog/ui/utils/posthogLinks";
import { navigateToShareTarget } from "@posthog/ui/utils/shareLinks";
import { getPostHogUrl } from "@posthog/ui/utils/urls";
import { type ReactNode, useMemo, useState } from "react";

type ArtifactRow =
  | { kind: "pr"; key: string; url: string }
  | { kind: "canvas"; key: string; name: string; url: string | null }
  | {
      kind: "plan";
      key: string;
      name: string;
      storagePath: string | null;
      runId: string | null;
    }
  | { kind: "slack"; key: string; url: string };

// Run artifacts live on the run JSON but aren't in the typed TaskRun, so the
// blob is validated at the boundary. Only plans are surfaced; other types are
// internal blobs.
function readRunPlans(run: TaskRun): RunArtifact[] {
  return parseRunPlans((run as { artifacts?: unknown }).artifacts);
}

// UUID-ish storage names make poor titles; fall back to a friendly label.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function planTitle(name: string | undefined): string {
  if (!name || UUID_RE.test(name)) return "Plan";
  return name;
}

/**
 * A task's artifacts across all runs: thread-announced PRs and canvases, every
 * run's output PR, plans, and the originating Slack thread. Internal upload
 * blobs are excluded.
 */
function buildRows(
  task: Task,
  timeline: ThreadTimelineRow<TaskThreadMessage>[],
  runs: TaskRun[],
): ArtifactRow[] {
  const rows: ArtifactRow[] = [];
  const seenPrUrls = new Set<string>();
  const seenPlanKeys = new Set<string>();

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
      rows.push({
        kind: "canvas",
        key: row.message.id,
        name: row.artifact.name,
        url: row.artifact.url,
      });
    }
  }

  // Fall back to latest_run while the runs list is still loading.
  const allRuns =
    runs.length > 0 ? runs : task.latest_run ? [task.latest_run] : [];
  for (const run of allRuns) {
    const outputPr = run.output?.pr_url;
    if (typeof outputPr === "string" && outputPr) {
      addPr(outputPr, `output-pr:${outputPr}`);
    }
    for (const plan of readRunPlans(run)) {
      const key = `plan:${plan.id ?? plan.storage_path ?? plan.name}`;
      if (seenPlanKeys.has(key)) continue;
      seenPlanKeys.add(key);
      rows.push({
        kind: "plan",
        key,
        name: planTitle(plan.name),
        storagePath: plan.storage_path ?? null,
        runId: run.id,
      });
    }
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
  onHoverStart,
}: {
  icon: ReactNode;
  title: string;
  detail?: string | null;
  external?: boolean;
  onOpen?: () => void;
  /** Fires once intent is shown, for detail a row defers fetching. */
  onHoverStart?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      onPointerEnter={onHoverStart}
      onFocus={onHoverStart}
      className="flex w-full items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-2 text-left text-[13px] transition-colors enabled:hover:bg-gray-3"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      {detail && (
        <span className="shrink-0 text-muted-foreground text-xs">{detail}</span>
      )}
      {external && (
        <ArrowSquareOutIcon size={12} className="shrink-0 text-gray-9" />
      )}
    </button>
  );
}

function PrRow({ url, taskId }: { url: string; taskId: string }) {
  const { safeUrl, title, stateLabel, Icon, iconColor } = usePrArtifact(url);
  const setReviewMode = useReviewNavigationStore((s) => s.setReviewMode);

  // Comment counts cost two extra round trips per row on top of the PR state,
  // and a task with several runs renders several rows — so they're fetched only
  // once the row is hovered. The state label is the signal; the count is detail.
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
      onOpen={() => setReviewMode(taskId, "split")}
    />
  );
}

function CanvasRow({ name, url }: { name: string; url: string | null }) {
  const parsed = url ? parseHttpsUrl(url) : null;
  const target = parsed ? parseShareLink(parsed.href) : null;
  const open =
    parsed && target
      ? () => {
          const currentPostHogUrl = getPostHogUrl("/");
          const currentPostHogOrigin = currentPostHogUrl
            ? parseHttpsUrl(currentPostHogUrl)?.origin
            : null;
          if (parsed.origin === currentPostHogOrigin) {
            navigateToShareTarget(target);
          } else {
            openExternalUrl(parsed.href);
          }
        }
      : undefined;
  return (
    <ArtifactListRow
      icon={iconForTemplate("", { size: 14, className: "text-violet-9" })}
      title={name}
      detail="Canvas"
      onOpen={open}
    />
  );
}

// Clicking presigns a fresh URL (needs task + run id + storage path) and opens it.
function PlanRow({
  taskId,
  runId,
  name,
  storagePath,
}: {
  taskId: string;
  runId: string | null;
  name: string;
  storagePath: string | null;
}) {
  const client = useOptionalAuthenticatedClient();
  const canOpen = !!client && !!runId && !!storagePath;
  const onOpen = canOpen
    ? () => {
        client
          .presignTaskRunArtifact(
            taskId,
            runId as string,
            storagePath as string,
          )
          .then((url) => openExternalUrl(url))
          .catch((error: unknown) => {
            toast.error("Couldn't open plan", {
              description:
                error instanceof Error ? error.message : String(error),
            });
          });
      }
    : undefined;
  return (
    <ArtifactListRow
      icon={<ClipboardTextIcon size={14} className="shrink-0 text-amber-9" />}
      title={name}
      detail="Plan"
      external={canOpen}
      onOpen={onOpen}
    />
  );
}

export function TaskArtifactsList({
  task,
  timeline,
}: {
  task: Task;
  timeline: ThreadTimelineRow<TaskThreadMessage>[];
}) {
  const { runs } = useTaskRuns(task.id);
  const rows = useMemo(
    () => buildRows(task, timeline, runs),
    [task, timeline, runs],
  );

  if (rows.length === 0) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PackageIcon size={18} />
          </EmptyMedia>
          <EmptyTitle>No artifacts yet</EmptyTitle>
          <EmptyDescription>
            Pull requests and canvases produced while working on this task show
            up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 p-2">
      {rows.map((row) =>
        row.kind === "pr" ? (
          <PrRow key={row.key} url={row.url} taskId={task.id} />
        ) : row.kind === "canvas" ? (
          <CanvasRow key={row.key} name={row.name} url={row.url} />
        ) : row.kind === "plan" ? (
          <PlanRow
            key={row.key}
            taskId={task.id}
            runId={row.runId}
            name={row.name}
            storagePath={row.storagePath}
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
    </div>
  );
}
