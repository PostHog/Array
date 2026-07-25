import { BellIcon, EnvelopeSimple, Lightning } from "@phosphor-icons/react";
import { countUnseenActivity } from "@posthog/core/canvas/mentionActivity";
import { cn } from "@posthog/quill";
import {
  ANALYTICS_EVENTS,
  type SidebarNavItem,
} from "@posthog/shared/analytics-events";
import { useMentionActivity } from "@posthog/ui/features/canvas/hooks/useMentionActivity";
import { useActivitySeenStore } from "@posthog/ui/features/canvas/stores/activitySeenStore";
import {
  formatHotkey,
  SHORTCUTS,
} from "@posthog/ui/features/command/keyboard-shortcuts";
import { useCommandCenterStore } from "@posthog/ui/features/command-center/commandCenterStore";
import { useInboxAllReports } from "@posthog/ui/features/inbox/hooks/useInboxAllReports";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import {
  navigateToActivity,
  navigateToInbox,
  navigateToWebsiteCommandCenter,
} from "@posthog/ui/router/navigationBridge";
import { useAppView } from "@posthog/ui/router/useAppView";
import { track } from "@posthog/ui/shell/analytics";
import type { ReactNode } from "react";
import { useMemo } from "react";

const INBOX_REFETCH_INTERVAL_MS = 60_000;

// Unread counts read red; the command center's filled cells are ambient, so
// they stay neutral.
function IconBadge({
  count,
  tone = "notification",
}: {
  count: number;
  tone?: "notification" | "neutral";
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "-top-1 -right-1 absolute inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 font-semibold text-[9px] tabular-nums leading-none ring-2 ring-chrome",
        tone === "notification"
          ? "bg-(--red-9) text-white"
          : "bg-gray-5 text-gray-11",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function NavIcon({
  icon,
  label,
  shortcut,
  isActive,
  onClick,
  badge,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  isActive: boolean;
  onClick: () => void;
  badge?: ReactNode;
}) {
  return (
    <Tooltip content={label} shortcut={shortcut} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          "relative flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-100",
          isActive
            ? "bg-fill-selected text-gray-12"
            : "bg-gray-3 text-gray-11 hover:bg-gray-4 hover:text-gray-12",
        )}
      >
        {icon}
        {badge}
      </button>
    </Tooltip>
  );
}

/**
 * Global destinations above the channel switcher. Search lives in the title
 * bar, and New task under the switcher, since it acts on the current channel.
 */
export function ChannelNav() {
  const view = useAppView();

  const { counts } = useInboxAllReports({
    ignoreFilters: true,
    refetchIntervalMs: INBOX_REFETCH_INTERVAL_MS,
  });
  const { items: activityItems } = useMentionActivity();
  const lastSeenAt = useActivitySeenStore((s) => s.lastSeenAt);
  const unseenActivity = useMemo(
    () => countUnseenActivity(activityItems, lastSeenAt),
    [activityItems, lastSeenAt],
  );
  // Its filled grid cells are the ambient "how much is parked there" count.
  const commandCenterCells = useCommandCenterStore((s) => s.cells);
  const commandCenterCount = commandCenterCells.filter((c) => c != null).length;

  const withTrack = (item: SidebarNavItem, action: () => void) => () => {
    track(ANALYTICS_EVENTS.SIDEBAR_NAV_ITEM_CLICKED, { item, in_more: false });
    action();
  };

  const isActivity = view.type === "activity";
  const isCommandCenter = view.type === "command-center";

  return (
    <div className="flex shrink-0 gap-2 px-2 pt-2 pb-2">
      <NavIcon
        icon={<EnvelopeSimple size={16} />}
        label="Inbox"
        shortcut={formatHotkey(SHORTCUTS.INBOX)}
        isActive={view.type === "inbox"}
        onClick={withTrack("inbox", navigateToInbox)}
        badge={<IconBadge count={counts.pulls} />}
      />
      <NavIcon
        icon={<BellIcon size={16} weight={isActivity ? "fill" : "regular"} />}
        label="Activity"
        isActive={isActivity}
        onClick={withTrack("activity", navigateToActivity)}
        badge={<IconBadge count={unseenActivity} />}
      />
      <NavIcon
        icon={
          <Lightning size={16} weight={isCommandCenter ? "fill" : "regular"} />
        }
        label="Command Center"
        isActive={isCommandCenter}
        onClick={withTrack("command_center", navigateToWebsiteCommandCenter)}
        badge={<IconBadge count={commandCenterCount} tone="neutral" />}
      />
    </div>
  );
}
