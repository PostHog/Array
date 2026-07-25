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

// The unified app sidebar (Code merged into the Bluebird chrome). Top to
// bottom: workspace switcher, the merged global nav, the "Enable channels"
// opt-in, then the body — the task list by default, swapped for the channel
// tree once channels are enabled — and Settings pinned to the bottom.
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
  // The Spaces layout has exactly one gate: its feature flag. When on it
  // subsumes the channels world (the "Enable channels" toggle is irrelevant
  // and hidden); when off, the toggle drives the old Channels alpha exactly
  // as before.
  const spacesOn = useSpacesLayout();
  const channelsWorld = spacesOn || channelsEnabled;
  // The Switch (in SidebarNavSection) reads the live value and flips instantly.
  // Swapping the sidebar body mounts a heavy tree (ChannelsList: the channels
  // query + a provider-laden row per channel), so defer that decision: the
  // urgent commit keeps the current body and paints the toggle, then the tree
  // mounts in a follow-up non-blocking render.
  const bodyChannelsWorld = useDeferredValue(channelsWorld);

  const archivedTaskIds = useArchivedTaskIds();

  // Spaces layout: while a channel is active the sidebar scopes to it. The
  // route is the source of truth — visiting any /website/$channelId page
  // adopts that channel as the current space, and it sticks across
  // channel-less routes (inbox, activity). Two transient body overrides sit
  // on top: browsing the full channel list ("#") and the draft new-space
  // chooser ("+"); picking any space dismisses them. All of this machinery is
  // inert while the flag is off.
  const params = useParams({ strict: false });
  const routeChannelId = params.channelId;
  const currentChannelId = useSpaceStore((s) => s.currentChannelId);
  const setCurrentChannel = useSpaceStore((s) => s.setCurrentChannel);
  const browsing = useSpaceStore((s) => s.browsing);
  const draftSpace = useSpaceStore((s) => s.draftSpace);
  const { channels } = useChannels({ enabled: spacesOn });
  useEffect(() => {
    if (!spacesOn || !routeChannelId) return;
    // Browsing the all-channels list is a preview: clicking a channel shows its
    // activity in the main view but keeps the directory open in the sidebar and
    // does NOT scope to (or pin) it. Only non-browse navigation (a dot, a deep
    // link, in-space nav) adopts a channel as the current space.
    if (useSpaceStore.getState().browsing) return;
    setCurrentChannel(routeChannelId);
  }, [spacesOn, routeChannelId, setCurrentChannel]);
  const inSpace =
    spacesOn && currentChannelId != null && !browsing && !draftSpace;

  // Leaving the channels world (navigating to a non-channel route) closes the
  // pickers. Previewing a channel from the browse list keeps the directory
  // open, so a navigation that lands on a channel route is left alone.
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

  // The personal "#me" space is the default: on first load with nothing
  // scoped, land there. Once any space has been current (including via the
  // route), never auto-scope again, so the pickers can't be hijacked.
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
        {/* The nav carries the whole merged nav (incl. the "Enable channels"
            toggle while the spaces flag is off). In the spaces layout the
            space chrome owns the sidebar (search / inbox / activity live in
            the title bar), so the nav only renders on the pre-scope landing;
            flag off keeps it always visible, exactly as before. */}
        {(!spacesOn ||
          (currentChannelId == null && !browsing && !draftSpace)) && (
          <SidebarNavSection />
        )}

        {/* Body precedence: (spaces only) the draft new-space chooser, then
            the active space; then the channel list (browse mode / landing /
            old channels alpha), else the task list. Each owns its own scroll
            region. Gated on the deferred value so the toggle paints before
            this heavy swap. */}
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
            {/* The fab is a sibling of the scroll region, not a child, so it
                stays pinned to the bottom-right instead of scrolling away. */}
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

        {/* Archived is a task-list affordance — hidden while the body shows
            the channel tree (old alpha) or a space, not tasks. */}
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

        {/* Arc-style space switcher: one dot per starred channel. Spaces
            layout only. */}
        {spacesOn && <SpaceDots />}

        {/* Workspace switcher pinned to the bottom. In the spaces layout it
            moves to the title bar (compact avatar) so the sidebar's bottom is
            freed for the space's content. */}
        {!spacesOn && (
          <Box className="shrink-0 px-2 pb-2">
            <ProjectSwitcher />
          </Box>
        )}
      </Flex>
    </ResizableSidebar>
  );
}
