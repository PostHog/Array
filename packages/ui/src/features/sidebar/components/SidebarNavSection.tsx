import { HashIcon } from "@phosphor-icons/react";
import { Badge, Switch } from "@posthog/quill";
import { LOOPS_FLAG, PROJECT_BLUEBIRD_FLAG } from "@posthog/shared";
import {
  ANALYTICS_EVENTS,
  type SidebarNavItem,
} from "@posthog/shared/analytics-events";
import { HOME_TAB_FLAG } from "@posthog/shared/constants";
import { useCommandCenterStore } from "@posthog/ui/features/command-center/commandCenterStore";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useInboxAllReports } from "@posthog/ui/features/inbox/hooks/useInboxAllReports";
import { openSettings } from "@posthog/ui/features/settings/hooks/useOpenSettings";
import {
  MORE_NAV_ITEMS,
  type MoreNavItemId,
} from "@posthog/ui/features/sidebar/constants";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import {
  navigateToActivity,
  navigateToAgents,
  navigateToCommandCenter,
  navigateToHome,
  navigateToInbox,
  navigateToLoops,
  navigateToMcpServers,
  navigateToSkills,
  navigateToWebsiteCommandCenter,
  navigateToWebsiteHome,
  navigateToWebsiteMcpServers,
  navigateToWebsiteSkills,
} from "@posthog/ui/router/navigationBridge";
import { useAppView } from "@posthog/ui/router/useAppView";
import { openTaskInput } from "@posthog/ui/router/useOpenTask";
import { track } from "@posthog/ui/shell/analytics";
import { useCommandMenuStore } from "@posthog/ui/shell/commandMenuStore";
import { Box, Flex } from "@radix-ui/themes";
import { useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { CustomizeSidebarDialog } from "./CustomizeSidebarDialog";
import { ActivityItem } from "./items/ActivityItem";
import { AgentsItem } from "./items/AgentsItem";
import { CommandCenterItem } from "./items/CommandCenterItem";
import { ConfigureItem } from "./items/ConfigureItem";
import { CustomizeSidebarItem } from "./items/CustomizeSidebarItem";
import { HomeItem } from "./items/HomeItem";
import { InboxItem } from "./items/InboxItem";
import { LoopsItem } from "./items/LoopsItem";
import { McpServersItem } from "./items/McpServersItem";
import { MoreItem } from "./items/MoreItem";
import { NewTaskItem } from "./items/NewTaskItem";
import { SearchItem } from "./items/SearchItem";
import { SkillsItem } from "./items/SkillsItem";

const SIDEBAR_INBOX_REFETCH_INTERVAL_MS = 60_000;

interface SidebarNavSectionProps {
  // The Command Center badge counts how many command-center cells point at a
  // live task. Deriving it needs the task list, which the Code pane's
  // SidebarMenu already subscribes to — so it passes the count down here to
  // avoid a second live useTasks subscription. The Channels pane renders this
  // standalone with no count, so the component derives its own (below).
  commandCenterActiveCount?: number;
}

// The sidebar navigation section shared by the Code pane (above the task list)
// and the Channels pane. It is fully self-contained — every item's active
// state, badge count, and click handler is wired here — so it can be dropped
// into either layout. In the Channels space, destinations with a /website
// mirror (Home, Skills, MCP servers, Command Center) stay in that space;
// Inbox, Agents and New task have no mirror yet and jump back to Code.
// Configure opens the shared settings UI. Search opens the command menu in
// place. Search, Skills and MCP servers are tucked under the collapsible More
// row by default; the Customize sidebar dialog promotes them back to the top
// level.
export function SidebarNavSection({
  commandCenterActiveCount: providedActiveCount,
}: SidebarNavSectionProps = {}) {
  const view = useAppView();
  const homeTabEnabled = useFeatureFlag(HOME_TAB_FLAG);
  // Loops stays behind the loops flag; default on in dev so local builds
  // keep the nav item. Also gates the per-channel Loops tab (see ChannelTabs).
  const loopsEnabled = useFeatureFlag(LOOPS_FLAG, import.meta.env.DEV);
  // Channels stay behind project-bluebird: the "Enable channels" nav row (and
  // the Canvas row it reveals) only appear where the canvas backend is wired.
  const bluebirdEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const channelsEnabled =
    useSidebarStore((s) => s.channelsEnabled) && bluebirdEnabled;
  const setChannelsEnabled = useSidebarStore((s) => s.setChannelsEnabled);

  // When this section renders inside the Channels space, the destinations that
  // have a /website mirror stay in that space; everything else (and the whole
  // section in the Code space) uses the canonical routes. Inbox and New task
  // have no mirror yet, so they intentionally jump back to Code.
  const inChannels = useRouterState({
    select: (s) => s.location.pathname.startsWith("/website"),
  });
  const goNewTask = () =>
    openTaskInput(inChannels ? { space: "website" } : undefined);
  const goHome = inChannels ? navigateToWebsiteHome : navigateToHome;
  const goSkills = inChannels ? navigateToWebsiteSkills : navigateToSkills;
  const goMcpServers = inChannels
    ? navigateToWebsiteMcpServers
    : navigateToMcpServers;
  const goCommandCenter = inChannels
    ? navigateToWebsiteCommandCenter
    : navigateToCommandCenter;

  // Active flags are pure functions of the current view — mirror what
  // useSidebarData derives, without pulling in its task-loading.
  const isHomeActive =
    view.type === "task-input" || view.type === "task-pending";
  const isHomeViewActive = view.type === "home";
  const isActivityActive = view.type === "activity";
  const isInboxActive = view.type === "inbox";
  const isAgentsActive = view.type === "agents";
  const isLoopsActive = view.type === "loops";
  const isCommandCenterActive = view.type === "command-center";
  const isSkillsActive = view.type === "skills";
  const isMcpServersActive = view.type === "mcp-servers";

  // Open pull requests in the inbox — the main CTA, and the same count the inbox
  // Pull requests tab shows, so the badge and the tab always agree.
  // `ignoreFilters` keeps the badge stable against the inbox's filter chrome;
  // scope still follows the user's For-you / project choice.
  // The sidebar mounts on every route, so its badge polls slowly; opening the
  // inbox adds its own 3s observers and React Query uses the shortest interval.
  const { counts: inboxCounts } = useInboxAllReports({
    ignoreFilters: true,
    refetchIntervalMs: SIDEBAR_INBOX_REFETCH_INTERVAL_MS,
  });
  const inboxPullRequestCount = inboxCounts.pulls;

  // Only subscribe to the task list when a parent hasn't already supplied the
  // count — keeps the standalone (Channels) render self-contained without
  // opening a redundant subscription when composed inside SidebarMenu.
  const needsOwnCount = providedActiveCount === undefined;
  const showAllUsers = useSidebarStore((s) => s.showAllUsers);
  const showInternal = useSidebarStore((s) => s.showInternal);
  const { data: allTasks = [] } = useTasks(
    { showAllUsers, showInternal },
    { enabled: needsOwnCount },
  );
  const commandCenterCells = useCommandCenterStore((s) => s.cells);
  const ownActiveCount = (() => {
    const taskIds = new Set(allTasks.map((t) => t.id));
    return commandCenterCells.filter(
      (taskId) => taskId != null && taskIds.has(taskId),
    ).length;
  })();
  const commandCenterActiveCount = providedActiveCount ?? ownActiveCount;

  const openCommandMenu = useCommandMenuStore((s) => s.open);

  // Every nav row reports which item was clicked so per-item usage is
  // measurable; in_more distinguishes clicks inside the expanded More section.
  const withNavTrack =
    (item: SidebarNavItem, action: () => void, inMore = false) =>
    () => {
      track(ANALYTICS_EVENTS.SIDEBAR_NAV_ITEM_CLICKED, {
        item,
        in_more: inMore,
      });
      action();
    };

  const hiddenNavItems = useSidebarStore((s) => s.hiddenNavItems);
  const hidden = new Set<MoreNavItemId>(hiddenNavItems);
  const [moreExpanded, setMoreExpanded] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  // While More is collapsed, an active item hidden under it takes over the
  // More row so the current page stays visible in the nav.
  const moreItemActive: Record<MoreNavItemId, boolean> = {
    search: false,
    skills: isSkillsActive,
    "mcp-servers": isMcpServersActive,
  };
  const activeHiddenItem = MORE_NAV_ITEMS.find(
    ({ id }) => hidden.has(id) && moreItemActive[id],
  );
  const takeoverLabel =
    !moreExpanded && activeHiddenItem ? activeHiddenItem.label : null;

  return (
    <Flex direction="column" className="shrink-0 gap-px px-2 py-2">
      <Box mb="2">
        <NewTaskItem
          isActive={isHomeActive}
          onClick={withNavTrack("new_task", goNewTask)}
        />
      </Box>

      {homeTabEnabled && (
        <Box>
          <HomeItem
            isActive={isHomeViewActive}
            onClick={withNavTrack("home", goHome)}
          />
        </Box>
      )}

      {!hidden.has("search") && (
        <Box>
          <SearchItem onClick={withNavTrack("search", openCommandMenu)} />
        </Box>
      )}

      <Box>
        <InboxItem
          isActive={isInboxActive}
          onClick={withNavTrack("inbox", navigateToInbox)}
          pullRequestCount={inboxPullRequestCount}
        />
      </Box>

      <Box>
        <ConfigureItem onClick={() => openSettings("agents")} />
      </Box>

      {loopsEnabled ? (
        <Box>
          <LoopsItem isActive={isLoopsActive} onClick={navigateToLoops} />
        </Box>
      ) : null}

      <Box>
        <AgentsItem
          isActive={isAgentsActive}
          onClick={withNavTrack("agents", navigateToAgents)}
        />
      </Box>

      {!hidden.has("skills") && (
        <Box>
          <SkillsItem
            isActive={isSkillsActive}
            onClick={withNavTrack("skills", goSkills)}
          />
        </Box>
      )}

      {!hidden.has("mcp-servers") && (
        <Box>
          <McpServersItem
            isActive={isMcpServersActive}
            onClick={withNavTrack("mcp_servers", goMcpServers)}
          />
        </Box>
      )}

      <Box>
        <CommandCenterItem
          isActive={isCommandCenterActive}
          onClick={withNavTrack("command_center", goCommandCenter)}
          activeCount={commandCenterActiveCount}
        />
      </Box>

      {/* Everything the user shoved off the top level lives here, plus the
          Customize entry point. Collapsed by default; when a hidden item is
          the active page it takes over the More row (see takeoverLabel). */}
      <Flex
        direction="column"
        className="gap-px"
        mb={bluebirdEnabled ? undefined : "2"}
      >
        <MoreItem
          expanded={moreExpanded}
          activeItemLabel={takeoverLabel}
          onClick={withNavTrack("more", () => setMoreExpanded((e) => !e))}
        />

        {moreExpanded && (
          <>
            {hidden.has("search") && (
              <SearchItem
                depth={1}
                onClick={withNavTrack("search", openCommandMenu, true)}
              />
            )}
            {hidden.has("skills") && (
              <SkillsItem
                depth={1}
                isActive={isSkillsActive}
                onClick={withNavTrack("skills", goSkills, true)}
              />
            )}
            {hidden.has("mcp-servers") && (
              <McpServersItem
                depth={1}
                isActive={isMcpServersActive}
                onClick={withNavTrack("mcp_servers", goMcpServers, true)}
              />
            )}
            <CustomizeSidebarItem
              depth={1}
              onClick={withNavTrack(
                "customize_sidebar",
                () => setCustomizeOpen(true),
                true,
              )}
            />
          </>
        )}
      </Flex>

      {/* "Channels" is a toggle laid out as a nav row: the # label and Alpha
          badge on the left, a Switch on the right. It flips the channels
          feature rather than routing — enabling it reveals the Canvas row
          below and swaps the sidebar body to the channel tree. A <label> (not a
          nav Button) so the Switch can live inside it without nesting buttons. */}
      {bluebirdEnabled && (
        <label
          htmlFor="channels-toggle"
          className="group flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] leading-snug transition-colors hover:bg-fill-secondary"
        >
          <span className="flex shrink-0 items-center opacity-80">
            <HashIcon size={14} />
          </span>
          <span className="min-w-0 truncate font-medium">Channels</span>
          <Badge variant="info">Alpha</Badge>
          <Switch
            id="channels-toggle"
            size="sm"
            className="ml-auto"
            checked={channelsEnabled}
            onCheckedChange={(checked) => {
              setChannelsEnabled(checked);
              track(ANALYTICS_EVENTS.SIDEBAR_NAV_ITEM_CLICKED, {
                item: "contexts",
                in_more: false,
              });
              track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
                action_type: "toggle_channels",
                surface: "nav",
              });
              // The unified sidebar removed the Code↔Channels space boundary;
              // this toggle is its successor. Keep firing the legacy
              // enter/leave events so space-adoption dashboards stay continuous.
              track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
                action_type: checked ? "enter_space" : "leave_space",
                surface: "nav",
              });
            }}
          />
        </label>
      )}

      {/* Activity (the mentions feed) is a channels surface, so it only appears
          once channels are enabled — sitting directly under the toggle that
          reveals it. */}
      {channelsEnabled && (
        <Box>
          <ActivityItem
            isActive={isActivityActive}
            onClick={withNavTrack("activity", navigateToActivity)}
          />
        </Box>
      )}

      <CustomizeSidebarDialog
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
      />
    </Flex>
  );
}
