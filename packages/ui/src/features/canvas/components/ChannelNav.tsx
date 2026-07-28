import {
  BellIcon,
  EnvelopeSimple,
  Lightning,
  RepeatIcon,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import {
  Button,
  Kbd,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";
import { LOOPS_FLAG } from "@posthog/shared";
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
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useInboxAllReports } from "@posthog/ui/features/inbox/hooks/useInboxAllReports";
import { openSettings } from "@posthog/ui/features/settings/hooks/useOpenSettings";
import { CountBadge } from "@posthog/ui/primitives/CountBadge";
import {
  navigateToActivity,
  navigateToInbox,
  navigateToLoops,
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
    <Tooltip>
      {/* quill's Button, with the sidebar's selected-row treatment — the same
          `data-selected` pairing the channel rows use, so the nav and the list
          below it read as one control set in either theme. `relative` is for
          the count badge, which pins to the button's corner. */}
      <TooltipTrigger
        render={
          <Button
            variant="default"
            size="icon"
            aria-label={label}
            data-selected={isActive || undefined}
            onClick={onClick}
            className="relative shrink-0 text-muted-foreground data-selected:bg-fill-selected data-selected:text-foreground"
          >
            {icon}
            {badge}
          </Button>
        }
      />
      <TooltipContent side="bottom">
        {label}
        {shortcut && <Kbd className="ml-1.5">{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

export function ChannelNav() {
  const view = useAppView();
  const loopsEnabled = useFeatureFlag(LOOPS_FLAG, import.meta.env.DEV);

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

  const isInbox = view.type === "inbox";
  const isActivity = view.type === "activity";
  const isCommandCenter = view.type === "command-center";

  return (
    // One provider for the row: once any tooltip is up, moving to its
    // neighbour reveals that one immediately instead of serving the warm-up
    // delay again. Per-tooltip providers (the old primitive mounted its own)
    // cannot do that — the skip window is provider state, and isolated
    // providers never share it.
    <TooltipProvider delay={400}>
      <div className="flex shrink-0 gap-2 px-2 pt-2 pb-1">
        <NavIcon
          icon={
            <EnvelopeSimple size={16} weight={isInbox ? "fill" : "regular"} />
          }
          label="Inbox"
          shortcut={formatHotkey(SHORTCUTS.INBOX)}
          isActive={isInbox}
          onClick={withTrack("inbox", navigateToInbox)}
          badge={
            <CountBadge count={counts.pulls} className={ICON_BADGE_CLASS} />
          }
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
            <Lightning
              size={16}
              weight={isCommandCenter ? "fill" : "regular"}
            />
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
        {loopsEnabled ? (
          <NavIcon
            icon={
              <RepeatIcon
                size={16}
                weight={view.type === "loops" ? "fill" : "regular"}
              />
            }
            label="Loops"
            isActive={view.type === "loops"}
            onClick={withTrack("loops", navigateToLoops)}
          />
        ) : null}
        <NavIcon
          icon={<SlidersHorizontal size={16} />}
          label="Configure"
          isActive={false}
          onClick={withTrack("configure", () => openSettings("agents"))}
        />
      </div>
    </TooltipProvider>
  );
}
