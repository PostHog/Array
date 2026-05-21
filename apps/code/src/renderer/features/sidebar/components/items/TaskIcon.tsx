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

// Clickable icon wrapper used when an origin-product thread URL is present.
// SidebarItem renders the row as a `<button>`, so a real `<a>` here would be
// invalid HTML — match the role="button" pattern used by TaskHoverToolbar and
// stop propagation so the task isn't selected when the user opens the thread.
function IconLink({
  url,
  ariaLabel,
  children,
}: {
  url: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const open = () => {
    void trpcClient.os.openExternal.mutate({ url });
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: nested clickable inside SidebarItem button
    <span
      role="link"
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
      {children}
    </span>
  );
}

function IconWrapper({
  link,
  ariaLabel,
  children,
}: {
  link?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  if (link && ariaLabel) {
    return (
      <IconLink url={link} ariaLabel={ariaLabel}>
        {children}
      </IconLink>
    );
  }
  return <span className="flex items-center justify-center">{children}</span>;
}

function CloudStatusIcon({
  taskRunStatus,
  originProduct,
  threadUrl,
}: {
  taskRunStatus?: TaskRunStatus;
  originProduct?: string;
  threadUrl?: string;
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
        <IconWrapper link={link} ariaLabel={ariaLabel}>
          <Icon size={ICON_SIZE} className="ph-pulse" />
        </IconWrapper>
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
        <IconWrapper link={link} ariaLabel={ariaLabel}>
          <Icon size={ICON_SIZE} weight="fill" color="var(--green-11)" />
        </IconWrapper>
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
        <IconWrapper link={link} ariaLabel={ariaLabel}>
          <Icon size={ICON_SIZE} weight="fill" color="var(--red-11)" />
        </IconWrapper>
      </Tooltip>
    );
  }
  return (
    <Tooltip
      content={link ? `Open ${sourceLabel} thread` : sourceLabel}
      side="right"
    >
      <IconWrapper link={link} ariaLabel={ariaLabel}>
        <Icon size={ICON_SIZE} />
      </IconWrapper>
    </Tooltip>
  );
}

function PrStatusIcon({
  prState,
  hasDiff,
}: {
  prState?: SidebarPrState;
  hasDiff?: boolean;
}) {
  if (prState === "merged") {
    return (
      <Tooltip content="PR merged" side="right">
        <span className="flex items-center justify-center">
          <GitMerge size={ICON_SIZE} weight="bold" color="var(--purple-11)" />
        </span>
      </Tooltip>
    );
  }
  if (prState === "open") {
    return (
      <Tooltip content="PR open" side="right">
        <span className="flex items-center justify-center">
          <GitPullRequest
            size={ICON_SIZE}
            weight="bold"
            color="var(--green-11)"
          />
        </span>
      </Tooltip>
    );
  }
  if (prState === "draft") {
    return (
      <Tooltip content="Draft PR" side="right">
        <span className="flex items-center justify-center">
          <GitPullRequest
            size={ICON_SIZE}
            weight="bold"
            color="var(--gray-9)"
          />
        </span>
      </Tooltip>
    );
  }
  if (prState === "closed") {
    return (
      <Tooltip content="PR closed" side="right">
        <span className="flex items-center justify-center">
          <GitPullRequest
            size={ICON_SIZE}
            weight="bold"
            color="var(--red-11)"
          />
        </span>
      </Tooltip>
    );
  }
  if (hasDiff) {
    return (
      <Tooltip content="Has changes" side="right">
        <span className="flex items-center justify-center">
          <GitBranch size={ICON_SIZE} weight="bold" color="var(--amber-11)" />
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
}: TaskIconProps) {
  const isCloudTask = workspaceMode === "cloud";
  const isTerminalCloud = isCloudTask && isTerminalStatus(taskRunStatus);
  const originProductMeta = getOriginProductMeta(originProduct);

  if (needsPermission) {
    return (
      <Tooltip content="Needs permission" side="right">
        <span className="flex items-center justify-center">
          <HandPalm size={ICON_SIZE} color="var(--blue-11)" />
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
      />
    );
  }
  if (isGenerating) {
    return <DotsCircleSpinner size={ICON_SIZE} className="text-accent-11" />;
  }
  if (isCloudTask) {
    return (
      <CloudStatusIcon
        taskRunStatus={taskRunStatus}
        originProduct={originProduct}
        threadUrl={slackThreadUrl}
      />
    );
  }
  if (isSuspended) {
    return (
      <Tooltip content="Suspended" side="right">
        <span className="flex items-center justify-center">
          <Pause size={ICON_SIZE} color="var(--gray-9)" />
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
    return <PrStatusIcon prState={prState} hasDiff={hasDiff} />;
  }
  if (isPinned) {
    return <PushPin size={ICON_SIZE} color="var(--accent-11)" />;
  }
  if (originProductMeta) {
    const { Icon, label } = originProductMeta;
    const link = slackThreadUrl;
    return (
      <Tooltip
        content={link ? `Open ${label} thread` : `From ${label}`}
        side="right"
      >
        <IconWrapper link={link} ariaLabel={`Open ${label} thread`}>
          <Icon size={ICON_SIZE} color="var(--gray-10)" />
        </IconWrapper>
      </Tooltip>
    );
  }
  return <ChatCircle size={ICON_SIZE} color="var(--gray-10)" />;
}
