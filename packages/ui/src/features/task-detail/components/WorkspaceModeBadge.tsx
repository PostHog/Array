import { Cloud, GitFork, HardDrives } from "@phosphor-icons/react";
import type { WorkspaceMode } from "@posthog/shared";
import { Tooltip } from "../../../primitives/Tooltip";

// Visual identity for each workspace mode, so a task's location (running on the
// local checkout, in an isolated git worktree, or in the cloud) is legible at a
// glance from the header without opening anything.
//
// Cloud mirrors the sidebar TaskIcon (Cloud glyph, accent). Worktree uses
// GitFork rather than GitBranch on purpose: the sidebar already uses an amber
// GitBranch to mean "has uncommitted changes", so reusing it here would be
// ambiguous. Worktree gets teal — a hue none of the sidebar status icons use.
const MODE_META: Record<
  WorkspaceMode,
  { Icon: typeof Cloud; label: string; color: string }
> = {
  local: {
    Icon: HardDrives,
    label: "Local — runs on your working copy",
    color: "var(--gray-10)",
  },
  worktree: {
    Icon: GitFork,
    label: "Worktree — runs in an isolated git worktree",
    color: "var(--teal-11)",
  },
  cloud: {
    Icon: Cloud,
    label: "Cloud — runs in the cloud",
    color: "var(--accent-11)",
  },
};

/**
 * Small icon shown before the task title that distinguishes where a task runs:
 * local working copy, isolated git worktree, or cloud. Renders nothing until
 * the workspace mode is known so it never flickers a wrong indicator.
 */
export function WorkspaceModeBadge({
  mode,
  size = 13,
}: {
  mode?: WorkspaceMode;
  size?: number;
}) {
  if (!mode) return null;
  const { Icon, label, color } = MODE_META[mode];
  return (
    <Tooltip content={label} side="bottom" delayDuration={300}>
      <span className="no-drag flex shrink-0 items-center justify-center">
        <Icon size={size} weight="fill" color={color} />
      </span>
    </Tooltip>
  );
}
