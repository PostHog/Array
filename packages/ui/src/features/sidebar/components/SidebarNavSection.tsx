import { HOME_TAB_FLAG } from "@posthog/shared/constants";
import { useCommandCenterStore } from "@posthog/ui/features/command-center/commandCenterStore";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useInboxAllReports } from "@posthog/ui/features/inbox/hooks/useInboxAllReports";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import {
  navigateToAgents,
  navigateToCommandCenter,
  navigateToHome,
  navigateToInbox,
  navigateToMcpServers,
  navigateToSkills,
  navigateToWebsiteCommandCenter,
  navigateToWebsiteHome,
  navigateToWebsiteMcpServers,
  navigateToWebsiteSkills,
} from "@posthog/ui/router/navigationBridge";
import { useAppView } from "@posthog/ui/router/useAppView";
import { openTaskInput } from "@posthog/ui/router/useOpenTask";
import { useCommandMenuStore } from "@posthog/ui/shell/commandMenuStore";
import { Box, Flex } from "@radix-ui/themes";
import { useRouterState } from "@tanstack/react-router";
import { AgentsItem } from "./items/AgentsItem";
import { CommandCenterItem } from "./items/CommandCenterItem";
import { HomeItem } from "./items/HomeItem";
import { InboxItem } from "./items/InboxItem";
import { McpServersItem } from "./items/McpServersItem";
import { NewTaskItem } from "./items/NewTaskItem";
import { SearchItem } from "./items/SearchItem";
import { SkillsItem } from "./items/SkillsItem";

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
// Inbox, Agents and New task have no mirror yet and jump back to Code. Search
// opens the command menu in place.
export function SidebarNavSection({
  commandCenterActiveCount: providedActiveCount,
}: SidebarNavSectionProps = {}) {
  const view = useAppView();
  const homeTabEnabled = useFeatureFlag(HOME_TAB_FLAG);

  // When this section renders inside the Channels space, the destinations that
  // have a /website mirror stay in that space; everything else (and the whole
  // section in the Code space) uses the canonical routes. Inbox, Agents and New
  // task have no mirror yet, so they intentionally jump back to Code.
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
  const isInboxActive = view.type === "inbox";
  const isAgentsActive = view.type === "agents";
  const isCommandCenterActive = view.type === "command-center";
  const isSkillsActive = view.type === "skills";
  const isMcpServersActive = view.type === "mcp-servers";

  // Open pull requests in the inbox — the main CTA, and the same count the inbox
  // Pull requests tab shows, so the badge and the tab always agree.
  // `ignoreFilters` keeps the badge stable against the inbox's filter chrome;
  // scope still follows the user's For-you / project choice.
  const { counts: inboxCounts } = useInboxAllReports({ ignoreFilters: true });
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

  return (
    <Flex direction="column" className="shrink-0 gap-px px-2 py-2">
      <Box mb="2">
        <NewTaskItem isActive={isHomeActive} onClick={goNewTask} />
      </Box>

      {homeTabEnabled && (
        <Box>
          <HomeItem isActive={isHomeViewActive} onClick={goHome} />
        </Box>
      )}

      <Box>
        <SearchItem onClick={openCommandMenu} />
      </Box>

      <Box>
        <InboxItem
          isActive={isInboxActive}
          onClick={navigateToInbox}
          pullRequestCount={inboxPullRequestCount}
        />
      </Box>

      <Box>
        <AgentsItem isActive={isAgentsActive} onClick={navigateToAgents} />
      </Box>

      <Box>
        <SkillsItem isActive={isSkillsActive} onClick={goSkills} />
      </Box>

      <Box>
        <McpServersItem isActive={isMcpServersActive} onClick={goMcpServers} />
      </Box>

      <Box mb="2">
        <CommandCenterItem
          isActive={isCommandCenterActive}
          onClick={goCommandCenter}
          activeCount={commandCenterActiveCount}
        />
      </Box>
    </Flex>
  );
}
