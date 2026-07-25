import {
  BellIcon,
  EnvelopeSimple,
  Lightning,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { countUnseenActivity } from "@posthog/core/canvas/mentionActivity";
import { cn, Separator } from "@posthog/quill";
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
import { useRouterState } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";

const INBOX_REFETCH_INTERVAL_MS = 60_000;

/*
 * Landscape pills in a 2x2 rather than a row of squares: a square small enough
 * to fit four across SIDEBAR_MIN_WIDTH leaves ~44px of caption, which truncates
 * the longest label ("Command Center" → "Comm…"). Segmented-control practice is
 * to size every cell to the longest label and keep labels to one or two words,
 * so the cells run landscape at a legible 11px and the label is abbreviated to
 * "Command" — the tooltip carries the full name.
 *
 * Width is fixed, not fluid: two 104px pills plus the gap come to 214px, inside
 * the 224px that SIDEBAR_MIN_WIDTH leaves after padding, and they stay that size
 * as the sidebar widens instead of ballooning.
 */
const PILL_WIDTH_CLASS = "w-[104px]";

// Inbox/activity counts read as unread (red); the command center's filled cells
// are ambient, so they stay neutral.
function PillBadge({
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
        "ml-auto inline-flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-full px-1 font-semibold text-[9px] tabular-nums leading-none",
        tone === "notification"
          ? "bg-(--red-9) text-white"
          : "bg-gray-5 text-gray-11",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * One global destination. The selected state layers a fill with brighter text
 * rather than relying on colour alone, and the tooltip carries the full name
 * plus shortcut — which is what `label` is abbreviated from.
 */
function NavPill({
  icon,
  label,
  fullLabel,
  shortcut,
  isActive,
  onClick,
  badge,
}: {
  icon: ReactNode;
  label: string;
  fullLabel?: string;
  shortcut?: string;
  isActive: boolean;
  onClick: () => void;
  badge?: ReactNode;
}) {
  const name = fullLabel ?? label;
  return (
    <Tooltip content={name} shortcut={shortcut} side="bottom">
      <button
        type="button"
        aria-label={name}
        onClick={onClick}
        className={cn(
          PILL_WIDTH_CLASS,
          "flex h-8 items-center gap-2 rounded-lg px-2 text-left transition-colors duration-100",
          isActive
            ? "bg-fill-selected text-gray-12"
            : "bg-gray-3 text-gray-11 hover:bg-gray-4 hover:text-gray-12",
        )}
      >
        <span className="flex shrink-0 items-center justify-center">
          {icon}
        </span>
        <span
          className={cn(
            "min-w-0 truncate text-[11px]",
            isActive ? "font-semibold" : "font-medium",
          )}
        >
          {label}
        </span>
        {badge}
      </button>
    </Tooltip>
  );
}

/**
 * The channel-scoped global nav: a 2x2 launcher for Search / Inbox / Activity /
 * Command Center, then New task below a rule — New task is an action on the
 * current channel, not one of the global destinations.
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
    <div className="shrink-0">
      <div className="grid w-fit grid-cols-2 gap-1.5 px-2 pt-2 pb-2">
        <NavPill
          icon={<MagnifyingGlass size={15} />}
          label="Search"
          shortcut={formatHotkey(SHORTCUTS.COMMAND_MENU)}
          isActive={false}
          onClick={withTrack("search", openCommandMenu)}
        />
        <NavPill
          icon={<EnvelopeSimple size={15} />}
          label="Inbox"
          shortcut={formatHotkey(SHORTCUTS.INBOX)}
          isActive={view.type === "inbox"}
          onClick={withTrack("inbox", navigateToInbox)}
          badge={<PillBadge count={counts.pulls} />}
        />
        <NavPill
          icon={<BellIcon size={15} weight={isActivity ? "fill" : "regular"} />}
          label="Activity"
          isActive={isActivity}
          onClick={withTrack("activity", navigateToActivity)}
          badge={<PillBadge count={unseenActivity} />}
        />
        <NavPill
          icon={
            <Lightning
              size={15}
              weight={isCommandCenter ? "fill" : "regular"}
            />
          }
          label="Command"
          fullLabel="Command Center"
          isActive={isCommandCenter}
          onClick={withTrack("command_center", navigateToWebsiteCommandCenter)}
          badge={<PillBadge count={commandCenterCount} tone="neutral" />}
        />
      </div>
      <Separator />
      <div className="px-2 py-2">
        <NewTaskItem
          isActive={pathname === `/website/${channelId}/new`}
          onClick={withTrack("new_task", () =>
            navigateToChannelNewTask(channelId),
          )}
        />
      </div>
    </div>
  );
}
