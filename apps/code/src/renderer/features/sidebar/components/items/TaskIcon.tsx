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

function CloudStatusIcon({
  taskRunStatus,
  originProduct,
}: {
  taskRunStatus?: TaskRunStatus;
  originProduct?: string;
}) {
  const meta = getOriginProductMeta(originProduct);
  const Icon = meta?.Icon ?? CloudIcon;
  const sourceLabel = meta?.label ?? "Cloud";
  if (taskRunStatus === "queued" || taskRunStatus === "in_progress") {
    return (
      <Tooltip content={`${sourceLabel} (running)`} side="right">
        <span className="flex items-center justify-center">
          <Icon size={ICON_SIZE} className="ph-pulse" />
        </span>
      </Tooltip>
    );
  }
  if (taskRunStatus === "completed") {
    return (
      <Tooltip content={`${sourceLabel} (completed)`} side="right">
        <span className="flex items-center justify-center">
          <Icon size={ICON_SIZE} weight="fill" color="var(--green-11)" />
        </span>
      </Tooltip>
    );
  }
  if (taskRunStatus === "failed" || taskRunStatus === "cancelled") {
    const label =
      taskRunStatus === "cancelled"
        ? `${sourceLabel} (cancelled)`
        : `${sourceLabel} (failed)`;
    return (
      <Tooltip content={label} side="right">
        <span className="flex items-center justify-center">
          <Icon size={ICON_SIZE} weight="fill" color="var(--red-11)" />
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={sourceLabel} side="right">
      <span className="flex items-center justify-center">
        <Icon size={ICON_SIZE} />
      </span>
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
    return (
      <Tooltip content={`From ${label}`} side="right">
        <span className="flex items-center justify-center">
          <Icon size={ICON_SIZE} color="var(--gray-10)" />
        </span>
      </Tooltip>
    );
  }
  return <ChatCircle size={ICON_SIZE} color="var(--gray-10)" />;
}
