import { DotsCircleSpinner } from "@components/DotsCircleSpinner";
import { Tooltip } from "@components/ui/Tooltip";
import type { SidebarPrState } from "@features/sidebar/hooks/useTaskPrStatus";
import type { WorkspaceMode } from "@main/services/workspace/schemas";
import {
  ChatCircle,
  Circle,
  Cloud as CloudIcon,
  GitBranch,
  GitMerge,
  GitPullRequest,
  HandPalm,
  Pause,
  PushPin,
  SlackLogo,
} from "@phosphor-icons/react";
import { trpcClient } from "@renderer/trpc/client";
import { isTerminalStatus, type TaskRunStatus } from "@shared/types";

export const ICON_SIZE = 12;

// Colors are passed as the phosphor `color` prop (an SVG `fill` attribute)
// rather than `text-*` classes: in the command palette, quill's
// `[data-highlighted] *` rule resets every descendant CSS `color` for the
// selected row, which turns a `currentColor` icon black on hover. An explicit
// `fill` is immune, and renders identically in the sidebar.

// Map origin_product values to the icon + label used to brand the task's
// status icon. Extend this when a new product (e.g. email, support) needs its
// own indicator.
type OriginProductMeta = { Icon: typeof SlackLogo; label: string };
const ORIGIN_PRODUCT_META: Record<string, OriginProductMeta> = {
  slack: { Icon: SlackLogo, label: "Slack" },
};

function getOriginProductMeta(
  originProduct?: string,
): OriginProductMeta | undefined {
  return originProduct ? ORIGIN_PRODUCT_META[originProduct] : undefined;
}

// Renders the icon inside a span. When `link` is set the span becomes
// clickable and opens the originating thread externally. SidebarItem renders
// the row as a `<button>`, so a real `<a>` here would be invalid HTML — match
// the inline role="button" pattern used by TaskHoverToolbar.
//
// Returned as a plain React element (not a component) so the span is the
// direct child of Tooltip — Radix's `asChild` Slot needs a host element to
// attach hover handlers to.
function renderIconSpan({
  icon,
  link,
  ariaLabel,
}: {
  icon: React.ReactNode;
  link?: string;
  ariaLabel?: string;
}) {
  if (!link) {
    return <span className="flex items-center justify-center">{icon}</span>;
  }
  const open = () => {
    void trpcClient.os.openExternal.mutate({ url: link });
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: nested clickable inside SidebarItem button
    <span
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      className="flex cursor-pointer items-center justify-center rounded transition-opacity hover:opacity-70"
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          open();
        }
      }}
    >
      {icon}
    </span>
  );
}

function CloudStatusIcon({
  taskRunStatus,
  originProduct,
  threadUrl,
  size,
}: {
  taskRunStatus?: TaskRunStatus;
  originProduct?: string;
  threadUrl?: string;
  size: number;
}) {
  const meta = getOriginProductMeta(originProduct);
  const Icon = meta?.Icon ?? CloudIcon;
  const sourceLabel = meta?.label ?? "Cloud";
  const link = meta && threadUrl ? threadUrl : undefined;
  const ariaLabel = link ? `Open ${sourceLabel} thread` : undefined;

  if (taskRunStatus === "queued" || taskRunStatus === "in_progress") {
    return (
      <Tooltip
        content={
          link ? `Open ${sourceLabel} thread` : `${sourceLabel} (running)`
        }
        side="right"
      >
        {renderIconSpan({
          icon: <Icon size={size} className="ph-pulse" />,
          link,
          ariaLabel,
        })}
      </Tooltip>
    );
  }
  if (taskRunStatus === "completed") {
    return (
      <Tooltip
        content={
          link ? `Open ${sourceLabel} thread` : `${sourceLabel} (completed)`
        }
        side="right"
      >
        {renderIconSpan({
          icon: <Icon size={size} weight="fill" color="var(--green-11)" />,
          link,
          ariaLabel,
        })}
      </Tooltip>
    );
  }
  if (taskRunStatus === "failed" || taskRunStatus === "cancelled") {
    const statusLabel =
      taskRunStatus === "cancelled"
        ? `${sourceLabel} (cancelled)`
        : `${sourceLabel} (failed)`;
    return (
      <Tooltip
        content={link ? `Open ${sourceLabel} thread` : statusLabel}
        side="right"
      >
        {renderIconSpan({
          icon: <Icon size={size} weight="fill" color="var(--red-11)" />,
          link,
          ariaLabel,
        })}
      </Tooltip>
    );
  }
  return (
    <Tooltip
      content={link ? `Open ${sourceLabel} thread` : sourceLabel}
      side="right"
    >
      {renderIconSpan({
        icon: <Icon size={size} />,
        link,
        ariaLabel,
      })}
    </Tooltip>
  );
}

function PrStatusIcon({
  prState,
  hasDiff,
  size,
}: {
  prState?: SidebarPrState;
  hasDiff?: boolean;
  size: number;
}) {
  if (prState === "merged") {
    return (
      <Tooltip content="PR merged" side="right">
        <span className="flex items-center justify-center">
          <GitMerge size={size} weight="bold" color="var(--purple-11)" />
        </span>
      </Tooltip>
    );
  }
  if (prState === "open") {
    return (
      <Tooltip content="PR open" side="right">
        <span className="flex items-center justify-center">
          <GitPullRequest size={size} weight="bold" color="var(--green-11)" />
        </span>
      </Tooltip>
    );
  }
  if (prState === "draft") {
    return (
      <Tooltip content="Draft PR" side="right">
        <span className="flex items-center justify-center">
          <GitPullRequest size={size} weight="bold" color="var(--gray-9)" />
        </span>
      </Tooltip>
    );
  }
  if (prState === "closed") {
    return (
      <Tooltip content="PR closed" side="right">
        <span className="flex items-center justify-center">
          <GitPullRequest size={size} weight="bold" color="var(--red-11)" />
        </span>
      </Tooltip>
    );
  }
  if (hasDiff) {
    return (
      <Tooltip content="Has changes" side="right">
        <span className="flex items-center justify-center">
          <GitBranch size={size} weight="bold" color="var(--amber-11)" />
        </span>
      </Tooltip>
    );
  }
  return null;
}

export interface TaskIconProps {
  workspaceMode?: WorkspaceMode;
  isGenerating?: boolean;
  isUnread?: boolean;
  isPinned?: boolean;
  isSuspended?: boolean;
  needsPermission?: boolean;
  taskRunStatus?: TaskRunStatus;
  originProduct?: string;
  /** Pre-built URL to the originating Slack thread (read from
   * `task.latest_run.state.slack_thread_url`). When set, the Slack icon
   * becomes a link that opens the thread in the user's browser. */
  slackThreadUrl?: string;
  prState?: SidebarPrState;
  hasDiff?: boolean;
  size?: number;
}

/**
 * Status icon for a task, shared by the sidebar task list and the command
 * palette so both render the exact same states (cloud run status, PR/branch
 * status, generating, unread, etc.).
 */
export function TaskIcon({
  workspaceMode,
  isGenerating,
  isUnread,
  isPinned,
  isSuspended,
  needsPermission,
  taskRunStatus,
  originProduct,
  slackThreadUrl,
  prState,
  hasDiff,
  size = ICON_SIZE,
}: TaskIconProps) {
  const isCloudTask = workspaceMode === "cloud";
  const isTerminalCloud = isCloudTask && isTerminalStatus(taskRunStatus);
  const originProductMeta = getOriginProductMeta(originProduct);

  if (needsPermission) {
    return (
      <Tooltip content="Needs permission" side="right">
        <span className="flex items-center justify-center">
          <HandPalm size={size} color="var(--blue-11)" />
        </span>
      </Tooltip>
    );
  }
  if (isTerminalCloud) {
    return (
      <CloudStatusIcon
        taskRunStatus={taskRunStatus}
        originProduct={originProduct}
        threadUrl={slackThreadUrl}
        size={size}
      />
    );
  }
  if (isGenerating) {
    return <DotsCircleSpinner size={size} className="text-accent-11" />;
  }
  if (isCloudTask) {
    return (
      <CloudStatusIcon
        taskRunStatus={taskRunStatus}
        originProduct={originProduct}
        threadUrl={slackThreadUrl}
        size={size}
      />
    );
  }
  if (isSuspended) {
    return (
      <Tooltip content="Suspended" side="right">
        <span className="flex items-center justify-center">
          <Pause size={size} color="var(--gray-9)" />
        </span>
      </Tooltip>
    );
  }
  if (isUnread) {
    return (
      <span className="flex items-center justify-center">
        <Circle size={8} weight="fill" color="var(--green-11)" />
      </span>
    );
  }
  if (prState || hasDiff) {
    return <PrStatusIcon prState={prState} hasDiff={hasDiff} size={size} />;
  }
  if (isPinned) {
    return <PushPin size={size} color="var(--accent-11)" />;
  }
  if (originProductMeta) {
    const { Icon, label } = originProductMeta;
    const link = slackThreadUrl;
    return (
      <Tooltip
        content={link ? `Open ${label} thread` : `From ${label}`}
        side="right"
      >
        {renderIconSpan({
          icon: <Icon size={size} color="var(--gray-10)" />,
          link,
          ariaLabel: `Open ${label} thread`,
        })}
      </Tooltip>
    );
  }
  return <ChatCircle size={size} color="var(--gray-10)" />;
}
