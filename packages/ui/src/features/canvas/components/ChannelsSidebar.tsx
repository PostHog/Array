import {
  BrainIcon,
  GearSixIcon,
  HouseIcon,
  RobotIcon,
  SquaresFourIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import { ChannelsList } from "@posthog/ui/features/canvas/components/ChannelsList";
import { openSettings } from "@posthog/ui/features/settings/hooks/useOpenSettings";
import { ProjectSwitcher } from "@posthog/ui/features/sidebar/components/ProjectSwitcher";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";
import {
  navigateToAgents,
  navigateToCanvas,
  navigateToHome,
  navigateToInbox,
  navigateToSkills,
} from "@posthog/ui/router/navigationBridge";
import { useAppView } from "@posthog/ui/router/useAppView";
import { Box, Flex } from "@radix-ui/themes";
import { useRouterState } from "@tanstack/react-router";

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
// no rail. These are app-wide destinations (they leave the Channels space for
// the corresponding Code view); the channel tree below is channel browsing.
function ChannelsNav() {
  const view = useAppView();
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
        onClick={navigateToHome}
      />
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
        onClick={navigateToInbox}
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
        onClick={navigateToCanvas}
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
        onClick={navigateToAgents}
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
        onClick={navigateToSkills}
      />
    </Flex>
  );
}

// The Channels-space sidebar: a single column owning the whole left pane. Top to
// bottom — workspace switcher, global nav, the channel tree, then Settings
// pinned to the bottom. There is no app rail in this space; the nav rows above
// are the cross-app navigation.
export function ChannelsSidebar() {
  return (
    <Flex direction="column" className="w-[220px] shrink-0 bg-gray-2">
      {/* Workspace switcher — a compact bordered button. The title bar above
          provides the window-drag region and stoplight clearance. */}
      <Box className="shrink-0 p-2 pb-0">
        <ProjectSwitcher triggerVariant="button" />
      </Box>

      {/* The whole nav (links + channel tree) scrolls as one — only the switcher
          above and Settings below stay pinned. */}
      <Box className="min-h-0 flex-1 overflow-y-auto">
        <ChannelsNav />
        <ChannelsList />
      </Box>

      {/* Settings pinned to the bottom. Settings is a full-page route, so this
          leaves the Channels space rather than highlighting in place. */}
      <Box className="shrink-0 p-2 pt-0">
        <SidebarItem
          depth={0}
          icon={<GearSixIcon size={16} />}
          label="Settings"
          onClick={() => openSettings()}
        />
      </Box>
    </Flex>
  );
}
