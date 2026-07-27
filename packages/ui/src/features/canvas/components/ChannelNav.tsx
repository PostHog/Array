import { BellIcon, EnvelopeSimple, Lightning } from "@phosphor-icons/react";
import { cn } from "@posthog/quill";
import {
  ANALYTICS_EVENTS,
  type SidebarNavItem,
} from "@posthog/shared/analytics-events";
import { useTaskActivity } from "@posthog/ui/features/canvas/hooks/useTaskActivity";
import {
  formatHotkey,
  SHORTCUTS,
} from "@posthog/ui/features/command/keyboard-shortcuts";
import { useCommandCenterActiveCount } from "@posthog/ui/features/command-center/useCommandCenterActiveCount";
import { useInboxAllReports } from "@posthog/ui/features/inbox/hooks/useInboxAllReports";
import { CountBadge } from "@posthog/ui/primitives/CountBadge";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import {
  navigateToActivity,
  navigateToInbox,
  navigateToWebsiteCommandCenter,
} from "@posthog/ui/router/navigationBridge";
import { useAppView } from "@posthog/ui/router/useAppView";
import { track } from "@posthog/ui/shell/analytics";
import type { ReactNode } from "react";

const INBOX_REFETCH_INTERVAL_MS = 60_000;

const ICON_BADGE_CLASS =
  "-top-1 -right-1 absolute h-3.5 min-w-3.5 w-auto px-1 font-semibold text-[9px] ring-2 ring-chrome";

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
            ? "bg-fill-selected text-foreground"
            : "text-muted-foreground hover:bg-fill-hover hover:text-foreground",
        )}
      >
        {icon}
        {badge}
      </button>
    </Tooltip>
  );
}

export function ChannelNav() {
  const view = useAppView();

  const { counts } = useInboxAllReports({
    ignoreFilters: true,
    refetchIntervalMs: INBOX_REFETCH_INTERVAL_MS,
  });
  const { unreadCount: unseenActivity } = useTaskActivity();
  const commandCenterCount = useCommandCenterActiveCount();

  const withTrack = (item: SidebarNavItem, action: () => void) => () => {
    track(ANALYTICS_EVENTS.SIDEBAR_NAV_ITEM_CLICKED, {
      item,
      in_more: false,
      layout: "channels",
    });
    action();
  };

  const isActivity = view.type === "activity";
  const isCommandCenter = view.type === "command-center";

  return (
    <div className="flex shrink-0 gap-2 px-2 pt-2 pb-1">
      <NavIcon
        icon={<EnvelopeSimple size={16} />}
        label="Inbox"
        shortcut={formatHotkey(SHORTCUTS.INBOX)}
        isActive={view.type === "inbox"}
        onClick={withTrack("inbox", navigateToInbox)}
        badge={<CountBadge count={counts.pulls} className={ICON_BADGE_CLASS} />}
      />
      <NavIcon
        icon={<BellIcon size={16} weight={isActivity ? "fill" : "regular"} />}
        label="Activity"
        isActive={isActivity}
        onClick={withTrack("activity", navigateToActivity)}
        badge={
          <CountBadge count={unseenActivity} className={ICON_BADGE_CLASS} />
        }
      />
      <NavIcon
        icon={
          <Lightning size={16} weight={isCommandCenter ? "fill" : "regular"} />
        }
        label="Command Center"
        isActive={isCommandCenter}
        onClick={withTrack("command_center", navigateToWebsiteCommandCenter)}
        badge={
          <CountBadge
            count={commandCenterCount}
            tone="neutral"
            className={ICON_BADGE_CLASS}
          />
        }
      />
    </div>
  );
}
