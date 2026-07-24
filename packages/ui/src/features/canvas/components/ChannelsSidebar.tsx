import { ArchiveIcon } from "@phosphor-icons/react";
import { Separator } from "@posthog/quill";
import { PROJECT_BLUEBIRD_FLAG } from "@posthog/shared";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { ChannelsFab } from "@posthog/ui/features/canvas/components/ChannelsFab";
import { ChannelsList } from "@posthog/ui/features/canvas/components/ChannelsList";
import { useChannelsSidebarStore } from "@posthog/ui/features/canvas/components/channelsSidebarStore";
import { NewSpaceDraft } from "@posthog/ui/features/canvas/components/NewSpaceDraft";
import { SpaceDots } from "@posthog/ui/features/canvas/components/SpaceDots";
import { SpaceSidebar } from "@posthog/ui/features/canvas/components/SpaceSidebar";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useSpaceSwipe } from "@posthog/ui/features/canvas/hooks/useSpaces";
import { useSpacesLayout } from "@posthog/ui/features/canvas/hooks/useSpacesLayout";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useSpaceStore } from "@posthog/ui/features/canvas/stores/spaceStore";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { LoopsPromoCard } from "@posthog/ui/features/loops/components/LoopsPromoCard";
import { useOnboardingStore } from "@posthog/ui/features/onboarding/onboardingStore";
import { ProjectSwitcher } from "@posthog/ui/features/sidebar/components/ProjectSwitcher";
import { SidebarMenu } from "@posthog/ui/features/sidebar/components/SidebarMenu";
import { SidebarNavSection } from "@posthog/ui/features/sidebar/components/SidebarNavSection";
import { UpdateBanner } from "@posthog/ui/features/sidebar/components/UpdateBanner";
import {
  beginSidebarPeek,
  cancelSidebarPeek,
  endSidebarPeek,
  useSidebarPeekStore,
} from "@posthog/ui/features/sidebar/sidebarPeekStore";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { useWorkspaces } from "@posthog/ui/features/workspace/useWorkspace";
import { useSidebarEdgeHoverPeek } from "@posthog/ui/primitives/hooks/useSidebarEdgeHoverPeek";
import { ResizableSidebar } from "@posthog/ui/primitives/ResizableSidebar";
import { navigateToArchived } from "@posthog/ui/router/navigationBridge";
import { Box, Flex } from "@radix-ui/themes";
import { useParams, useRouterState } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useRef } from "react";

// The unified app sidebar. Top to bottom: global nav, then the body — the task
// list, the channel tree, or (spaces layout) the active space — and the
// account switcher pinned to the bottom.
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
  // Spaces subsumes the channels world when on (the toggle is then hidden);
  // when off, the toggle drives the old Channels alpha. `channelsWorld` = the
  // body shows channels either way.
  const spacesOn = useSpacesLayout();
  const channelsWorld = spacesOn || channelsEnabled;
  // Deferred so the toggle paints before the heavy channel tree (ChannelsList
  // mounts a provider-laden row per channel) swaps in.
  const bodyChannelsWorld = useDeferredValue(channelsWorld);

  const archivedTaskIds = useArchivedTaskIds();

  // Spaces scoping (see spaceStore for the model): the route is the source of
  // truth — a /website/$channelId page adopts that channel as the current
  // space. Inert while the flag is off.
  const params = useParams({ strict: false });
  const routeChannelId = params.channelId;
  const currentChannelId = useSpaceStore((s) => s.currentChannelId);
  const setCurrentChannel = useSpaceStore((s) => s.setCurrentChannel);
  const browsing = useSpaceStore((s) => s.browsing);
  const draftSpace = useSpaceStore((s) => s.draftSpace);
  const { channels } = useChannels({ enabled: spacesOn });
  useEffect(() => {
    if (!spacesOn || !routeChannelId) return;
    // Browsing is a preview — it shows a channel's activity without scoping to
    // it, so don't adopt the route while the directory is open.
    if (useSpaceStore.getState().browsing) return;
    setCurrentChannel(routeChannelId);
  }, [spacesOn, routeChannelId, setCurrentChannel]);
  const inSpace =
    spacesOn && currentChannelId != null && !browsing && !draftSpace;

  // Navigating to a non-channel route closes the browse/draft pickers.
  const historyIndex = useRouterState({
    select: (s) => s.location.state.__TSR_index,
  });
  const prevHistoryIndexRef = useRef(historyIndex);
  useEffect(() => {
    if (prevHistoryIndexRef.current === historyIndex) return;
    prevHistoryIndexRef.current = historyIndex;
    if (!spacesOn || routeChannelId) return;
    const state = useSpaceStore.getState();
    if (state.browsing) state.setBrowsing(false);
    if (state.draftSpace) state.setDraftSpace(false);
  }, [historyIndex, routeChannelId, spacesOn]);

  // Default to the personal "#me" space on first load; once any space has been
  // current, never auto-scope again so the pickers can't be hijacked.
  const autoScopedRef = useRef(false);
  useEffect(() => {
    if (currentChannelId) autoScopedRef.current = true;
  }, [currentChannelId]);
  useEffect(() => {
    if (!spacesOn || autoScopedRef.current || currentChannelId) return;
    if (browsing || draftSpace) return;
    const me = channels.find((c) => c.name === PERSONAL_CHANNEL_NAME);
    if (me) {
      autoScopedRef.current = true;
      setCurrentChannel(me.id);
    }
  }, [
    spacesOn,
    channels,
    currentChannelId,
    browsing,
    draftSpace,
    setCurrentChannel,
  ]);

  // Horizontal trackpad swipe anywhere on the sidebar cycles spaces — from a
  // space, the channel list, or the draft view alike. One space per gesture.
  const handleSpaceSwipe = useSpaceSwipe(spacesOn);

  return (
    <ResizableSidebar
      open={open}
      width={width}
      setWidth={setWidth}
      isResizing={isResizing}
      setIsResizing={setIsResizing}
      side="left"
      setOpen={setOpen}
      peek={peek}
      onPeekEnter={beginSidebarPeek}
      onPeekLeave={() => endSidebarPeek()}
      onPeekDismiss={cancelSidebarPeek}
    >
      <Flex
        direction="column"
        className="h-full bg-chrome"
        onWheel={handleSpaceSwipe}
      >
        {/* In spaces, the title bar owns search/inbox/activity, so the nav
            only shows on the pre-scope landing; flag off keeps it always on. */}
        {(!spacesOn ||
          (currentChannelId == null && !browsing && !draftSpace)) && (
          <SidebarNavSection />
        )}

        {/* Body precedence: draft chooser → active space (spaces only) →
            channel list (browse / landing / old alpha) → task list. */}
        {bodyChannelsWorld && spacesOn && draftSpace ? (
          <Box className="min-h-0 flex-1 overflow-hidden">
            <NewSpaceDraft />
          </Box>
        ) : bodyChannelsWorld && inSpace && currentChannelId ? (
          <Box className="min-h-0 flex-1 overflow-hidden">
            <SpaceSidebar channelId={currentChannelId} />
          </Box>
        ) : bodyChannelsWorld ? (
          <>
            <Separator />
            {/* Fab is a sibling of the scroll region so it stays pinned. */}
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

        {/* Archived is a task-list affordance — hidden when the body isn't tasks. */}
        {!channelsWorld && archivedTaskIds.size > 0 && (
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

        {/* Space switcher: one dot per starred channel. Spaces layout only. */}
        {spacesOn && <SpaceDots />}

        {/* Account switcher — moves to the title bar in the spaces layout. */}
        {!spacesOn && (
          <Box className="shrink-0 px-2 pb-2">
            <ProjectSwitcher />
          </Box>
        )}
      </Flex>
    </ResizableSidebar>
  );
}
