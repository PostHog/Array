import {
  BrainIcon,
  GearSixIcon,
  HouseIcon,
  RobotIcon,
  SquaresFourIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { HOME_TAB_FLAG } from "@posthog/shared/constants";
import { ChannelsList } from "@posthog/ui/features/canvas/components/ChannelsList";
import { useChannelsSidebarStore } from "@posthog/ui/features/canvas/components/channelsSidebarStore";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { openSettings } from "@posthog/ui/features/settings/hooks/useOpenSettings";
import { ProjectSwitcher } from "@posthog/ui/features/sidebar/components/ProjectSwitcher";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";
import { UpdateBanner } from "@posthog/ui/features/sidebar/components/UpdateBanner";
import { ResizableSidebar } from "@posthog/ui/primitives/ResizableSidebar";
import {
  navigateToAgents,
  navigateToCanvas,
  navigateToInbox,
  navigateToSkills,
  navigateToWebsiteHome,
} from "@posthog/ui/router/navigationBridge";
import { useAppView } from "@posthog/ui/router/useAppView";
import { track } from "@posthog/ui/shell/analytics";
import { Box, Flex } from "@radix-ui/themes";
import { useRouterState } from "@tanstack/react-router";

// Fire a nav_click event, then run the destination's navigation.
function trackNav(navTarget: string, navigate: () => void) {
  track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
    action_type: "nav_click",
    surface: "nav",
    nav_target: navTarget,
  });
  navigate();
}

// Non-canvas /website mirrors (Home, Files, etc.) — used to tell whether the
// current /website route is a canvas surface (channels index / a channel / a
// dashboard) so the Canvas nav item highlights only there.
const NON_CANVAS_WEBSITE_PREFIXES = [
  "/website/home",
  "/website/skills",
  "/website/mcp-servers",
  "/website/command-center",
];

// The global nav brought over from the Code app — a single icon+label row each,
// no rail. Home points at the /website/home mirror so it stays in the Channels
// space (same shared HomeView, channels chrome kept); the other rows are
// app-wide destinations that leave the Channels space for the Code view. The
// channel tree below is channel browsing.
function ChannelsNav() {
  const view = useAppView();
  const homeTabEnabled = useFeatureFlag(HOME_TAB_FLAG);
  // Active on the canvas surfaces: the channels index, a channel, or a canvas —
  // any /website route that isn't one of the cross-app mirrors above.
  const isCanvasActive = useRouterState({
    select: (s) => {
      const path = s.location.pathname;
      return (
        path.startsWith("/website") &&
        !NON_CANVAS_WEBSITE_PREFIXES.some((p) => path.startsWith(p))
      );
    },
  });
  return (
    <Flex direction="column" className="shrink-0 gap-px px-2 py-2">
      {homeTabEnabled && (
        <SidebarItem
          depth={0}
          icon={
            <HouseIcon
              size={16}
              weight={view.type === "home" ? "fill" : "regular"}
            />
          }
          label="Home"
          isActive={view.type === "home"}
          onClick={() => trackNav("home", navigateToWebsiteHome)}
        />
      )}
      <SidebarItem
        depth={0}
        icon={
          <TrayIcon
            size={16}
            weight={view.type === "inbox" ? "fill" : "regular"}
          />
        }
        label="Global Inbox"
        isActive={view.type === "inbox"}
        onClick={() => trackNav("inbox", navigateToInbox)}
      />
      <SidebarItem
        depth={0}
        icon={
          <SquaresFourIcon
            size={16}
            weight={isCanvasActive ? "fill" : "regular"}
          />
        }
        label="Canvas"
        isActive={isCanvasActive}
        onClick={() => trackNav("canvas", navigateToCanvas)}
      />
      <SidebarItem
        depth={0}
        icon={
          <RobotIcon
            size={16}
            weight={view.type === "agents" ? "fill" : "regular"}
          />
        }
        label="Agents"
        isActive={view.type === "agents"}
        onClick={() => trackNav("agents", navigateToAgents)}
      />
      <SidebarItem
        depth={0}
        icon={
          <BrainIcon
            size={16}
            weight={view.type === "skills" ? "fill" : "regular"}
          />
        }
        label="Files"
        isActive={view.type === "skills"}
        onClick={() => trackNav("files", navigateToSkills)}
      />
    </Flex>
  );
}

// The Channels-space sidebar: a single column owning the whole left pane. Top to
// bottom — workspace switcher, global nav, the channel tree, then Settings
// pinned to the bottom. There is no app rail in this space; the nav rows above
// are the cross-app navigation.
export function ChannelsSidebar() {
  const width = useChannelsSidebarStore((state) => state.width);
  const setWidth = useChannelsSidebarStore((state) => state.setWidth);
  const isResizing = useChannelsSidebarStore((state) => state.isResizing);
  const setIsResizing = useChannelsSidebarStore((state) => state.setIsResizing);

  return (
    <ResizableSidebar
      open
      width={width}
      setWidth={setWidth}
      isResizing={isResizing}
      setIsResizing={setIsResizing}
      side="left"
    >
      <Flex direction="column" className="h-full bg-gray-2">
        {/* Workspace switcher — a compact bordered button. The title bar above
            provides the window-drag region and stoplight clearance. */}
        <Box className="shrink-0 p-2 pb-0">
          <ProjectSwitcher triggerVariant="button" />
        </Box>

        {/* The whole nav (links + channel tree) scrolls as one — only the switcher
            above and Settings below stay pinned. */}
        <Box className="scroll-mask-4 min-h-0 flex-1 overflow-y-auto">
          <ChannelsNav />
          <ChannelsList />
        </Box>

        <UpdateBanner />

        {/* Settings pinned to the bottom. Settings is a full-page route, so this
            leaves the Channels space rather than highlighting in place. */}
        <Box className="shrink-0 p-2 pt-0">
          <SidebarItem
            depth={0}
            icon={<GearSixIcon size={16} />}
            label="Settings"
            onClick={() => trackNav("settings", () => openSettings())}
          />
        </Box>
      </Flex>
    </ResizableSidebar>
  );
}
