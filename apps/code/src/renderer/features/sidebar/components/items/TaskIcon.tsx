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
} from "@phosphor-icons/react";
import { isTerminalStatus, type TaskRunStatus } from "@shared/types";

export const ICON_SIZE = 12;

// Colors are passed as the phosphor `color` prop (an SVG `fill` attribute)
// rather than `text-*` classes: in the command palette, quill's
// `[data-highlighted] *` rule resets every descendant CSS `color` for the
// selected row, which turns a `currentColor` icon black on hover. An explicit
// `fill` is immune, and renders identically in the sidebar.

function CloudStatusIcon({
  taskRunStatus,
  size,
}: {
  taskRunStatus?: TaskRunStatus;
  size: number;
}) {
  if (taskRunStatus === "queued" || taskRunStatus === "in_progress") {
    return (
      <Tooltip content="Cloud (running)" side="right">
        <span className="flex items-center justify-center">
          <CloudIcon size={size} className="ph-pulse" />
        </span>
      </Tooltip>
    );
  }
  if (taskRunStatus === "completed") {
    return (
      <Tooltip content="Cloud (completed)" side="right">
        <span className="flex items-center justify-center">
          <CloudIcon size={size} weight="fill" color="var(--green-11)" />
        </span>
      </Tooltip>
    );
  }
  if (taskRunStatus === "failed" || taskRunStatus === "cancelled") {
    const label =
      taskRunStatus === "cancelled" ? "Cloud (cancelled)" : "Cloud (failed)";
    return (
      <Tooltip content={label} side="right">
        <span className="flex items-center justify-center">
          <CloudIcon size={size} weight="fill" color="var(--red-11)" />
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="Cloud" side="right">
      <span className="flex items-center justify-center">
        <CloudIcon size={size} />
      </span>
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
  prState,
  hasDiff,
  size = ICON_SIZE,
}: TaskIconProps) {
  const isCloudTask = workspaceMode === "cloud";
  const isTerminalCloud = isCloudTask && isTerminalStatus(taskRunStatus);

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
    return <CloudStatusIcon taskRunStatus={taskRunStatus} size={size} />;
  }
  if (isGenerating) {
    return <DotsCircleSpinner size={size} className="text-accent-11" />;
  }
  if (isCloudTask) {
    return <CloudStatusIcon taskRunStatus={taskRunStatus} size={size} />;
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
  return <ChatCircle size={size} color="var(--gray-10)" />;
}
