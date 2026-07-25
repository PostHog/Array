import { ArchiveIcon } from "@phosphor-icons/react";
import { Separator } from "@posthog/quill";
import { PROJECT_BLUEBIRD_FLAG } from "@posthog/shared";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { ChannelNav } from "@posthog/ui/features/canvas/components/ChannelNav";
import { ChannelSidebar } from "@posthog/ui/features/canvas/components/ChannelSidebar";
import { ChannelsFab } from "@posthog/ui/features/canvas/components/ChannelsFab";
import { ChannelsList } from "@posthog/ui/features/canvas/components/ChannelsList";
import { useChannelsSidebarStore } from "@posthog/ui/features/canvas/components/channelsSidebarStore";
import { useChannelsLayout } from "@posthog/ui/features/canvas/hooks/useChannelsLayout";
import { useCurrentChannel } from "@posthog/ui/features/canvas/hooks/useCurrentChannel";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useTrackChannelsSpaceViewed } from "@posthog/ui/features/canvas/hooks/useTrackChannelsSpaceViewed";
import { useCurrentChannelStore } from "@posthog/ui/features/canvas/stores/currentChannelStore";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { LoopsPromoCard } from "@posthog/ui/features/loops/components/LoopsPromoCard";
import { useOnboardingStore } from "@posthog/ui/features/onboarding/onboardingStore";
import { ProjectSwitcher } from "@posthog/ui/features/sidebar/components/ProjectSwitcher";
import { SidebarMenu } from "@posthog/ui/features/sidebar/components/SidebarMenu";
import { SidebarNavSection } from "@posthog/ui/features/sidebar/components/SidebarNavSection";
import { UpdateBanner } from "@posthog/ui/features/sidebar/components/UpdateBanner";
import { CHANNELS_SIDEBAR_MIN_WIDTH } from "@posthog/ui/features/sidebar/constants";
import {
  beginSidebarPeek,
  cancelSidebarPeek,
  endSidebarPeek,
  useSidebarPeekStore,
} from "@posthog/ui/features/sidebar/sidebarPeekStore";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { useWorkspaces } from "@posthog/ui/features/workspace/useWorkspace";
import { ErrorBoundary } from "@posthog/ui/primitives/ErrorBoundary";
import { useSidebarEdgeHoverPeek } from "@posthog/ui/primitives/hooks/useSidebarEdgeHoverPeek";
import { ResizableSidebar } from "@posthog/ui/primitives/ResizableSidebar";
import { navigateToArchived } from "@posthog/ui/router/navigationBridge";
import { Box, Flex } from "@radix-ui/themes";
import { useParams } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useRef } from "react";

export function ChannelsSidebar() {
  const width = useChannelsSidebarStore((state) => state.width);
  const setWidth = useChannelsSidebarStore((state) => state.setWidth);
  const isResizing = useChannelsSidebarStore((state) => state.isResizing);
  const setIsResizing = useChannelsSidebarStore((state) => state.setIsResizing);

  // Cmd+B collapses the sidebar (via useSidebarStore.open, toggled globally in
  // GlobalEventHandlers / the command menu). Auto-open once the user has
  // finished onboarding or has any workspace, matching the retired MainSidebar —
  // so a brand-new user sees the welcome screen without the sidebar beside it.
  const open = useSidebarStore((s) => s.open);
  const setOpen = useSidebarStore((s) => s.setOpen);
  const setOpenAuto = useSidebarStore((s) => s.setOpenAuto);
  const hasCompletedOnboarding = useOnboardingStore(
    (s) => s.hasCompletedOnboarding,
  );
  const { data: workspaces = {}, isFetched: workspacesFetched } =
    useWorkspaces();
  useEffect(() => {
    if (!workspacesFetched) return;
    setOpenAuto(hasCompletedOnboarding || Object.keys(workspaces).length > 0);
  }, [workspacesFetched, workspaces, hasCompletedOnboarding, setOpenAuto]);

  const peek = useSidebarPeekStore((s) => s.peek);
  useSidebarEdgeHoverPeek({
    enabled: !open && !isResizing,
    peeked: peek,
    side: "left",
    width,
    onReveal: beginSidebarPeek,
    onClose: () => endSidebarPeek(),
  });
  useEffect(() => {
    if (open) cancelSidebarPeek();
  }, [open]);
  // The peek store is a module-level singleton — if this sidebar unmounts
  // while peeked (route without it), a stale peek would greet the remount.
  useEffect(() => () => cancelSidebarPeek(), []);

  // Channels stay behind project-bluebird: the toggle only appears where the
  // canvas backend is wired, and a persisted "on" is ignored when the flag is
  // off so the sidebar can't strand a user on an unsupported feature.
  const bluebirdEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const channelsEnabled =
    useSidebarStore((s) => s.channelsEnabled) && bluebirdEnabled;
  // The new layout subsumes the channels alpha when on (the toggle is then
  // hidden); when off, the toggle drives the alpha. `channelsWorld` = the body
  // shows channels either way.
  const channelsLayout = useChannelsLayout();
  const channelsWorld = channelsLayout || channelsEnabled;
  // Deferred so the toggle paints before the heavy channel tree (ChannelsList
  // mounts a provider-laden row per channel) swaps in.
  const bodyChannelsWorld = useDeferredValue(channelsWorld);
  // The channels *alpha* replaced the task list with the channel tree, so the
  // Archived row went with it. The new layout keeps its own item list and puts
  // an Archive action on every row, so it needs the destination back — this is
  // the only entry point to /code/archived in the app. Reads the deferred value
  // so the row and the body it belongs to switch on the same paint.
  const showArchivedRow = channelsLayout || !bodyChannelsWorld;
  useTrackChannelsSpaceViewed({
    enabled: channelsWorld,
    layout: channelsLayout ? "channels" : "code",
  });

  // The channels layout's title bar needs more room than the shared floor, so
  // it raises the minimum here rather than in the constant — leaving the width
  // of everyone on the old layout untouched.
  const minWidth = channelsLayout ? CHANNELS_SIDEBAR_MIN_WIDTH : undefined;
  useEffect(() => {
    if (channelsLayout && width < CHANNELS_SIDEBAR_MIN_WIDTH) {
      setWidth(CHANNELS_SIDEBAR_MIN_WIDTH);
    }
  }, [channelsLayout, width, setWidth]);

  const archivedTaskIds = useArchivedTaskIds();

  // The route is the source of truth: a /website/$channelId page adopts that
  // channel as current. Inert while the flag is off.
  const params = useParams({ strict: false });
  const routeChannelId = params.channelId;
  const setCurrentChannel = useCurrentChannelStore((s) => s.setCurrentChannel);
  // Resolves the scoped id against the live list, and clears it when the flag
  // is off or the channel no longer exists — so `currentChannelId` here is
  // always a channel we can actually render.
  const { currentChannelId, channels } = useCurrentChannel({
    enabled: channelsLayout,
  });
  useEffect(() => {
    if (!channelsLayout || !routeChannelId) return;
    setCurrentChannel(routeChannelId);
  }, [channelsLayout, routeChannelId, setCurrentChannel]);
  const inChannel = channelsLayout && currentChannelId != null;

  // Default to the personal "#me" channel on first load, then leave the choice
  // alone. The latch resets when the layout turns off so a flag that resolves
  // late (useFeatureFlag re-syncs on every flags payload) can't strand the
  // sidebar unscoped for the rest of the session.
  const autoScopedRef = useRef(false);
  useEffect(() => {
    if (!channelsLayout) {
      autoScopedRef.current = false;
      return;
    }
    // A route-scoped channel wins over the default. Both effects run from the
    // same render on a cold deep link, so without this guard the route effect
    // writes its channel and this later effect immediately overwrites it with
    // #me using the stale `currentChannelId` captured by that render.
    if (routeChannelId || autoScopedRef.current || currentChannelId) return;
    const me = channels.find((c) => c.name === PERSONAL_CHANNEL_NAME);
    if (!me) return;
    autoScopedRef.current = true;
    setCurrentChannel(me.id);
  }, [
    channelsLayout,
    channels,
    currentChannelId,
    routeChannelId,
    setCurrentChannel,
  ]);

  return (
    <ResizableSidebar
      open={open}
      width={width}
      setWidth={setWidth}
      isResizing={isResizing}
      setIsResizing={setIsResizing}
      side="left"
      minWidth={minWidth}
      setOpen={setOpen}
      peek={peek}
      onPeekEnter={beginSidebarPeek}
      onPeekLeave={() => endSidebarPeek()}
      onPeekDismiss={cancelSidebarPeek}
    >
      <Flex direction="column" className="h-full bg-chrome">
        {!inChannel && <SidebarNavSection />}

        {inChannel && currentChannelId ? (
          <>
            <ChannelNav />
            <Box className="min-h-0 flex-1 overflow-hidden">
              {/* The channel sidebar is the whole sidebar under this layout, so
                  a throw in one row would otherwise take ProjectSwitcher — the
                  only route to settings and project switching — down with it.
                  Degrade to the flat channel list instead. */}
              <ErrorBoundary
                name="channel-sidebar"
                fallback={<ChannelsList />}
                resetKey={currentChannelId}
              >
                <ChannelSidebar channelId={currentChannelId} />
              </ErrorBoundary>
            </Box>
          </>
        ) : bodyChannelsWorld ? (
          <>
            <Separator />
            <Box className="relative min-h-0 flex-1">
              <Box className="scroll-mask-4 h-full overflow-y-auto">
                <ChannelsList />
              </Box>
              <ChannelsFab />
            </Box>
          </>
        ) : (
          <Box className="min-h-0 flex-1">
            <SidebarMenu />
          </Box>
        )}

        <UpdateBanner />

        {showArchivedRow && archivedTaskIds.size > 0 && (
          <Box className="shrink-0 border-border border-t">
            <button
              type="button"
              className="flex w-full items-center gap-1 bg-transparent px-2 py-1.5 text-left text-[13px] text-gray-11 transition-colors hover:bg-gray-3"
              onClick={navigateToArchived}
            >
              <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-gray-10">
                <ArchiveIcon size={14} />
              </span>
              <span className="text-gray-11">Archived</span>
            </button>
          </Box>
        )}

        <LoopsPromoCard />

        <Box className="shrink-0 px-2 pb-2">
          <ProjectSwitcher />
        </Box>
      </Flex>
    </ResizableSidebar>
  );
}
