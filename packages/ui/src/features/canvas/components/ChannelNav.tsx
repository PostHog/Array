import {
  BellIcon,
  EnvelopeSimple,
  Lightning,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { countUnseenActivity } from "@posthog/core/canvas/mentionActivity";
import { cn } from "@posthog/quill";
import {
  ANALYTICS_EVENTS,
  type SidebarNavItem,
} from "@posthog/shared/analytics-events";
import { useMentionActivity } from "@posthog/ui/features/canvas/hooks/useMentionActivity";
import { useActivitySeenStore } from "@posthog/ui/features/canvas/stores/activitySeenStore";
import { SHORTCUTS } from "@posthog/ui/features/command/keyboard-shortcuts";
import { useCommandCenterStore } from "@posthog/ui/features/command-center/commandCenterStore";
import { useInboxAllReports } from "@posthog/ui/features/inbox/hooks/useInboxAllReports";
import { NewTaskItem } from "@posthog/ui/features/sidebar/components/items/NewTaskItem";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import {
  navigateToActivity,
  navigateToChannelNewTask,
  navigateToInbox,
  navigateToWebsiteCommandCenter,
} from "@posthog/ui/router/navigationBridge";
import { useAppView } from "@posthog/ui/router/useAppView";
import { track } from "@posthog/ui/shell/analytics";
import { useCommandMenuStore } from "@posthog/ui/shell/commandMenuStore";
import { Box, Flex } from "@radix-ui/themes";
import { useRouterState } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";

const INBOX_REFETCH_INTERVAL_MS = 60_000;

// A corner count on a nav tile — red for unread-style counts, neutral for
// ambient counts like the command center's filled cells.
function TileBadge({
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
        "absolute top-0.5 right-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] leading-none",
        tone === "notification"
          ? "bg-(--red-9) text-white"
          : "bg-gray-5 text-gray-12",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

// An Arc-style square icon tile: label lives in the tooltip, count in the
// corner. Used for the channel-scoped global nav (search / inbox / activity /
// command center).
function NavTile({
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
          "relative flex aspect-square items-center justify-center rounded-lg border border-border bg-gray-2 text-gray-11 transition-colors hover:bg-gray-3 hover:text-gray-12",
          isActive && "border-transparent bg-fill-selected text-gray-12",
        )}
      >
        {icon}
        {badge}
      </button>
    </Tooltip>
  );
}

/**
 * The channel-scoped global nav: New task on top, then an Arc-style tile grid
 * for Search / Inbox / Activity / Command Center. Shown above the channel
 * switcher.
 */
export function ChannelNav({ channelId }: { channelId: string }) {
  const view = useAppView();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const openCommandMenu = useCommandMenuStore((s) => s.open);

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
  // Command Center lives in the /website space here; count the filled grid
  // cells as its active indicator.
  const commandCenterCells = useCommandCenterStore((s) => s.cells);
  const commandCenterCount = commandCenterCells.filter((c) => c != null).length;

  const withTrack = (item: SidebarNavItem, action: () => void) => () => {
    track(ANALYTICS_EVENTS.SIDEBAR_NAV_ITEM_CLICKED, { item, in_more: false });
    action();
  };

  return (
    <Flex direction="column" className="shrink-0 gap-2 px-2 pt-2 pb-2">
      <Box>
        <NewTaskItem
          isActive={pathname === `/website/${channelId}/new`}
          onClick={withTrack("new_task", () =>
            navigateToChannelNewTask(channelId),
          )}
        />
      </Box>
      <div className="grid grid-cols-4 gap-1.5">
        <NavTile
          icon={<MagnifyingGlass size={18} />}
          label="Search"
          shortcut={SHORTCUTS.COMMAND_MENU}
          isActive={false}
          onClick={withTrack("search", openCommandMenu)}
        />
        <NavTile
          icon={<EnvelopeSimple size={18} />}
          label="Inbox"
          shortcut={SHORTCUTS.INBOX}
          isActive={view.type === "inbox"}
          onClick={withTrack("inbox", navigateToInbox)}
          badge={<TileBadge count={counts.pulls} />}
        />
        <NavTile
          icon={
            <BellIcon
              size={18}
              weight={view.type === "activity" ? "fill" : "regular"}
            />
          }
          label="Activity"
          isActive={view.type === "activity"}
          onClick={withTrack("activity", navigateToActivity)}
          badge={<TileBadge count={unseenActivity} />}
        />
        <NavTile
          icon={
            <Lightning
              size={18}
              weight={view.type === "command-center" ? "fill" : "regular"}
            />
          }
          label="Command Center"
          isActive={view.type === "command-center"}
          onClick={withTrack("command_center", navigateToWebsiteCommandCenter)}
          badge={<TileBadge count={commandCenterCount} tone="neutral" />}
        />
      </div>
    </Flex>
  );
}
