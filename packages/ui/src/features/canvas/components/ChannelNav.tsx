import {
  BellIcon,
  EnvelopeSimple,
  Lightning,
  RepeatIcon,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import { cn, Popover, PopoverTrigger } from "@posthog/quill";
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
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import {
  navigateToActivity,
  navigateToInbox,
  navigateToLoops,
  navigateToWebsiteCommandCenter,
} from "@posthog/ui/router/navigationBridge";
import { useAppView } from "@posthog/ui/router/useAppView";
import { track } from "@posthog/ui/shell/analytics";
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
  useState,
} from "react";
import { ActivityHoverCard } from "./ActivityHoverCard";

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
      <NavButton
        icon={icon}
        label={label}
        isActive={isActive}
        onClick={onClick}
        badge={badge}
      />
    </Tooltip>
  );
}

interface NavButtonProps extends ComponentPropsWithoutRef<"button"> {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  badge?: ReactNode;
}

const NavButton = forwardRef<HTMLButtonElement, NavButtonProps>(
  (
    { icon, label, isActive, onClick, badge, className, ...buttonProps },
    ref,
  ) => (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-100",
        isActive
          ? "bg-fill-selected text-foreground"
          : "text-muted-foreground hover:bg-fill-hover hover:text-foreground",
        className,
      )}
    >
      {icon}
      {badge}
    </button>
  ),
);
NavButton.displayName = "NavButton";

export function ChannelNav() {
  const view = useAppView();
  const loopsEnabled = useFeatureFlag(LOOPS_FLAG, import.meta.env.DEV);
  const [activityOpen, setActivityOpen] = useState(false);

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
      <Popover open={activityOpen} onOpenChange={setActivityOpen}>
        <PopoverTrigger
          openOnHover
          delay={300}
          closeDelay={150}
          render={
            <NavButton
              icon={
                <BellIcon size={16} weight={isActivity ? "fill" : "regular"} />
              }
              label="Activity"
              isActive={isActivity}
              onClick={() => {
                setActivityOpen(false);
                withTrack("activity", navigateToActivity)();
              }}
              badge={
                <CountBadge
                  count={unseenActivity}
                  className={ICON_BADGE_CLASS}
                />
              }
            />
          }
        />
        {activityOpen && (
          <ActivityHoverCard onClose={() => setActivityOpen(false)} />
        )}
      </Popover>
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
  );
}
