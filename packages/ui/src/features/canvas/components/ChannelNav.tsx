import {
  ANALYTICS_EVENTS,
  type SidebarNavItem,
} from "@posthog/shared/analytics-events";
import { useInboxAllReports } from "@posthog/ui/features/inbox/hooks/useInboxAllReports";
import { ActivityItem } from "@posthog/ui/features/sidebar/components/items/ActivityItem";
import { InboxItem } from "@posthog/ui/features/sidebar/components/items/InboxItem";
import { SearchItem } from "@posthog/ui/features/sidebar/components/items/SearchItem";
import {
  navigateToActivity,
  navigateToInbox,
} from "@posthog/ui/router/navigationBridge";
import { useAppView } from "@posthog/ui/router/useAppView";
import { track } from "@posthog/ui/shell/analytics";
import { useCommandMenuStore } from "@posthog/ui/shell/commandMenuStore";
import { Flex } from "@radix-ui/themes";

const INBOX_REFETCH_INTERVAL_MS = 60_000;

/** Search / Inbox / Activity rows shown above the channel switcher. */
export function ChannelNav() {
  const view = useAppView();
  const openCommandMenu = useCommandMenuStore((s) => s.open);
  const { counts } = useInboxAllReports({
    ignoreFilters: true,
    refetchIntervalMs: INBOX_REFETCH_INTERVAL_MS,
  });

  const withTrack = (item: SidebarNavItem, action: () => void) => () => {
    track(ANALYTICS_EVENTS.SIDEBAR_NAV_ITEM_CLICKED, { item, in_more: false });
    action();
  };

  return (
    <Flex direction="column" className="shrink-0 gap-px px-2 pt-2 pb-2">
      <SearchItem onClick={withTrack("search", openCommandMenu)} />
      <InboxItem
        isActive={view.type === "inbox"}
        onClick={withTrack("inbox", navigateToInbox)}
        pullRequestCount={counts.pulls}
      />
      <ActivityItem
        isActive={view.type === "activity"}
        onClick={withTrack("activity", navigateToActivity)}
      />
    </Flex>
  );
}
