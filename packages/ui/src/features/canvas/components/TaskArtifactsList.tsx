import {
  ArrowSquareOutIcon,
  PackageIcon,
  SlackLogoIcon,
} from "@phosphor-icons/react";
import type { ThreadTimelineRow } from "@posthog/core/canvas/threadTimeline";
import {
  getPrVisualConfig,
  parsePrNumber,
} from "@posthog/core/git-interaction/prStatus";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@posthog/quill";
import type { Task, TaskThreadMessage } from "@posthog/shared/domain-types";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import { useReviewNavigationStore } from "@posthog/ui/features/code-review/reviewNavigationStore";
import { getPrVisualIcon } from "@posthog/ui/features/git-interaction/prIcon";
import { usePrDetails } from "@posthog/ui/features/git-interaction/usePrDetails";
import { usePrComments } from "@posthog/ui/features/pr-review/usePrComments";
import { usePrReviewThreads } from "@posthog/ui/features/pr-review/usePrReviewThreads";
import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import { parseShareLink } from "@posthog/ui/utils/posthogLinks";
import { navigateToShareTarget } from "@posthog/ui/utils/shareLinks";
import { getPostHogUrl } from "@posthog/ui/utils/urls";
import { type ReactNode, useMemo } from "react";

type ArtifactRow =
  | { kind: "pr"; key: string; url: string }
  | { kind: "canvas"; key: string; name: string; url: string | null }
  | { kind: "slack"; key: string; url: string };

function parseHttpsUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Everything this task produced or is anchored to, derived with no new
 * backend: PRs and canvases the agent announced on the task thread, the run
 * output's PR as a fallback, and the originating Slack thread (external link).
 */
function buildRows(
  task: Task,
  timeline: ThreadTimelineRow<TaskThreadMessage>[],
): ArtifactRow[] {
  const rows: ArtifactRow[] = [];
  const seenPrUrls = new Set<string>();

  for (const row of timeline) {
    if (row.kind !== "artifact") continue;
    if (row.artifact.kind === "pr") {
      if (seenPrUrls.has(row.artifact.url)) continue;
      seenPrUrls.add(row.artifact.url);
      rows.push({ kind: "pr", key: row.message.id, url: row.artifact.url });
    } else {
      rows.push({
        kind: "canvas",
        key: row.message.id,
        name: row.artifact.name,
        url: row.artifact.url,
      });
    }
  }

  const outputPr = task.latest_run?.output?.pr_url;
  if (typeof outputPr === "string" && outputPr && !seenPrUrls.has(outputPr)) {
    rows.push({ kind: "pr", key: `output-pr:${outputPr}`, url: outputPr });
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
}: {
  icon: ReactNode;
  title: string;
  detail?: string | null;
  external?: boolean;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
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

// PR row: live state + comment count from GitHub. Clicking opens the diff in
// the task's review pane (the mockup's "on click, show diff").
function PrRow({ url, taskId }: { url: string; taskId: string }) {
  const parsed = parseHttpsUrl(url);
  const safeUrl = parsed?.origin === "https://github.com" ? parsed.href : null;
  const {
    meta: { state, merged, draft },
  } = usePrDetails(safeUrl);
  const comments = usePrComments(safeUrl);
  const threads = usePrReviewThreads(safeUrl);
  const setReviewMode = useReviewNavigationStore((s) => s.setReviewMode);

  const config = getPrVisualConfig(state ?? "open", merged, draft);
  const PrIcon = getPrVisualIcon(config.icon);
  const prNumber = safeUrl ? parsePrNumber(safeUrl) : null;

  const commentCount =
    (comments.data?.length ?? 0) +
    (threads.data ?? []).reduce(
      (sum, thread) => sum + thread.comments.length,
      0,
    );
  const detailParts = [
    state ? config.label : null,
    comments.data || threads.data
      ? `${commentCount} ${commentCount === 1 ? "comment" : "comments"}`
      : null,
  ].filter(Boolean);

  return (
    <ArtifactListRow
      icon={
        <PrIcon
          size={14}
          weight="bold"
          className="shrink-0"
          style={{ color: `var(--${config.color}-9)` }}
        />
      }
      title={prNumber ? `Pull request #${prNumber}` : "Pull request"}
      detail={detailParts.join(" · ") || null}
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

export function TaskArtifactsList({
  task,
  timeline,
}: {
  task: Task;
  timeline: ThreadTimelineRow<TaskThreadMessage>[];
}) {
  const rows = useMemo(() => buildRows(task, timeline), [task, timeline]);

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
