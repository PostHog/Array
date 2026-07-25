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
import {
  formatHotkey,
  SHORTCUTS,
} from "@posthog/ui/features/command/keyboard-shortcuts";
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
import { Flex } from "@radix-ui/themes";
import { useRouterState } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";

const INBOX_REFETCH_INTERVAL_MS = 60_000;

// Tiles are a fixed 48px so they read the same at any sidebar width. Four of
// them plus gaps fit inside SIDEBAR_MIN_WIDTH (240 - 16 padding = 224 ≥ 210),
// so the row never wraps; a wider sidebar just leaves trailing space.
const TILE_CLASS =
  "relative flex size-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-gray-2 text-gray-11 transition-colors hover:bg-gray-3 hover:text-gray-12";

// A corner count on a nav tile — red for unread-style counts, neutral for
// ambient ones like the command center's filled cells.
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
        "absolute top-0.5 right-0.5 inline-flex h-3 min-w-3 items-center justify-center rounded-full px-[3px] text-[8px] leading-none",
        tone === "notification"
          ? "bg-(--red-9) text-white"
          : "bg-gray-5 text-gray-12",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * A launcher tile: icon over a short caption, so the destination is legible
 * without hovering. The tooltip carries the full name and shortcut, which is
 * what `caption` is abbreviated from.
 */
function NavTile({
  icon,
  label,
  caption,
  shortcut,
  isActive,
  onClick,
  badge,
}: {
  icon: ReactNode;
  label: string;
  caption: string;
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
          TILE_CLASS,
          isActive && "border-transparent bg-fill-selected text-gray-12",
        )}
      >
        {icon}
        <span className="max-w-full truncate px-0.5 text-[10px] leading-none">
          {caption}
        </span>
        {badge}
      </button>
    </Tooltip>
  );
}

/**
 * The channel-scoped global nav: a launcher row for Search / Inbox / Activity
 * / Command Center, then New task. Sits above the channel switcher.
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
  // Command Center lives in the /website space here; its filled grid cells are
  // the ambient "how much is parked in there" count.
  const commandCenterCells = useCommandCenterStore((s) => s.cells);
  const commandCenterCount = commandCenterCells.filter((c) => c != null).length;

  const withTrack = (item: SidebarNavItem, action: () => void) => () => {
    track(ANALYTICS_EVENTS.SIDEBAR_NAV_ITEM_CLICKED, { item, in_more: false });
    action();
  };

  const isActivity = view.type === "activity";
  const isCommandCenter = view.type === "command-center";

  return (
    <Flex direction="column" className="shrink-0 gap-2 px-2 pt-2 pb-2">
      <div className="flex gap-1.5">
        <NavTile
          icon={<MagnifyingGlass size={16} />}
          label="Search"
          caption="Search"
          shortcut={formatHotkey(SHORTCUTS.COMMAND_MENU)}
          isActive={false}
          onClick={withTrack("search", openCommandMenu)}
        />
        <NavTile
          icon={<EnvelopeSimple size={16} />}
          label="Inbox"
          caption="Inbox"
          shortcut={formatHotkey(SHORTCUTS.INBOX)}
          isActive={view.type === "inbox"}
          onClick={withTrack("inbox", navigateToInbox)}
          badge={<TileBadge count={counts.pulls} />}
        />
        <NavTile
          icon={<BellIcon size={16} weight={isActivity ? "fill" : "regular"} />}
          label="Activity"
          caption="Activity"
          isActive={isActivity}
          onClick={withTrack("activity", navigateToActivity)}
          badge={<TileBadge count={unseenActivity} />}
        />
        <NavTile
          icon={
            <Lightning
              size={16}
              weight={isCommandCenter ? "fill" : "regular"}
            />
          }
          label="Command Center"
          caption="Command"
          isActive={isCommandCenter}
          onClick={withTrack("command_center", navigateToWebsiteCommandCenter)}
          badge={<TileBadge count={commandCenterCount} tone="neutral" />}
        />
      </div>
      <NewTaskItem
        isActive={pathname === `/website/${channelId}/new`}
        onClick={withTrack("new_task", () =>
          navigateToChannelNewTask(channelId),
        )}
      />
    </Flex>
  );
}
