import { ArchiveIcon, GearSixIcon } from "@phosphor-icons/react";
import { Button, Separator } from "@posthog/quill";
import { PROJECT_BLUEBIRD_FLAG } from "@posthog/shared";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { ChannelsFab } from "@posthog/ui/features/canvas/components/ChannelsFab";
import { ChannelsList } from "@posthog/ui/features/canvas/components/ChannelsList";
import { useChannelsSidebarStore } from "@posthog/ui/features/canvas/components/channelsSidebarStore";
import { NewSpaceDraft } from "@posthog/ui/features/canvas/components/NewSpaceDraft";
import { SpaceDots } from "@posthog/ui/features/canvas/components/SpaceDots";
import { SpaceSidebar } from "@posthog/ui/features/canvas/components/SpaceSidebar";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useSpaceStore } from "@posthog/ui/features/canvas/stores/spaceStore";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { LoopsPromoCard } from "@posthog/ui/features/loops/components/LoopsPromoCard";
import { useOnboardingStore } from "@posthog/ui/features/onboarding/onboardingStore";
import { openSettings } from "@posthog/ui/features/settings/hooks/useOpenSettings";
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
  // The Switch (in SidebarNavSection) reads the live value and flips instantly.
  // Swapping the sidebar body mounts a heavy tree (ChannelsList: the channels
  // query + a provider-laden row per channel), so defer that decision: the
  // urgent commit keeps the current body and paints the toggle, then the tree
  // mounts in a follow-up non-blocking render.
  const bodyChannelsEnabled = useDeferredValue(channelsEnabled);

  const archivedTaskIds = useArchivedTaskIds();

  // Spaces layout (prototype): while a channel is active the sidebar scopes to
  // it (Arc-style space). The route is the source of truth — visiting any
  // /website/$channelId page adopts that channel as the current space, and it
  // sticks across channel-less routes (inbox, activity). Two transient body
  // overrides sit on top: browsing the full channel list ("#") and the draft
  // new-space chooser ("+"); picking any space dismisses them.
  const params = useParams({ strict: false });
  const routeChannelId = params.channelId;
  const currentChannelId = useSpaceStore((s) => s.currentChannelId);
  const setCurrentChannel = useSpaceStore((s) => s.setCurrentChannel);
  const browsing = useSpaceStore((s) => s.browsing);
  const draftSpace = useSpaceStore((s) => s.draftSpace);
  useEffect(() => {
    if (routeChannelId) setCurrentChannel(routeChannelId);
  }, [routeChannelId, setCurrentChannel]);
  const inSpace =
    channelsEnabled && currentChannelId != null && !browsing && !draftSpace;

  // Any navigation while a picker override is open dismisses it — the user
  // moved somewhere, so the picker's moment has passed. This also covers
  // re-selecting the channel you're already in (the route doesn't change, so
  // the sync effect above never fires).
  const historyIndex = useRouterState({
    select: (s) => s.location.state.__TSR_index,
  });
  const prevHistoryIndexRef = useRef(historyIndex);
  useEffect(() => {
    if (prevHistoryIndexRef.current === historyIndex) return;
    prevHistoryIndexRef.current = historyIndex;
    const state = useSpaceStore.getState();
    if (state.browsing) state.setBrowsing(false);
    if (state.draftSpace) state.setDraftSpace(false);
  }, [historyIndex]);

  // The personal "#me" space is the default: on first load with nothing
  // scoped, land there. Once any space has been current (including via the
  // route), never auto-scope again, so the pickers can't be hijacked.
  const { channels } = useChannels({ enabled: channelsEnabled });
  const autoScopedRef = useRef(false);
  useEffect(() => {
    if (currentChannelId) autoScopedRef.current = true;
  }, [currentChannelId]);
  useEffect(() => {
    if (!channelsEnabled || autoScopedRef.current || currentChannelId) return;
    if (browsing || draftSpace) return;
    const me = channels.find((c) => c.name === PERSONAL_CHANNEL_NAME);
    if (me) {
      autoScopedRef.current = true;
      setCurrentChannel(me.id);
    }
  }, [
    channelsEnabled,
    channels,
    currentChannelId,
    browsing,
    draftSpace,
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
      setOpen={setOpen}
      peek={peek}
      onPeekEnter={beginSidebarPeek}
      onPeekLeave={() => endSidebarPeek()}
      onPeekDismiss={cancelSidebarPeek}
    >
      <Flex direction="column" className="h-full bg-chrome">
        {/* The nav owns the "Enable channels" toggle + Canvas rows (gated by
            the same flag), so this section carries the whole merged nav.
            Hidden while a space or the new-space draft is active: those own
            the whole body (search/inbox/activity live in the title bar). */}
        {!inSpace && !draftSpace && <SidebarNavSection />}

        {/* Body precedence: the draft new-space chooser, then the active
            space, then the channel list (browse mode / landing), else the
            task list. Each owns its own scroll region. Gated on the deferred
            value so the toggle paints before this heavy swap. */}
        {bodyChannelsEnabled && draftSpace ? (
          <Box className="min-h-0 flex-1 overflow-hidden">
            <NewSpaceDraft />
          </Box>
        ) : bodyChannelsEnabled && inSpace && currentChannelId ? (
          <Box className="min-h-0 flex-1 overflow-hidden">
            <SpaceSidebar channelId={currentChannelId} />
          </Box>
        ) : bodyChannelsEnabled ? (
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

        {/* Archived is a task-list affordance — hidden while channels are on,
            since the body then shows the channel tree, not tasks. */}
        {!channelsEnabled && archivedTaskIds.size > 0 && (
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

        {/* Arc-style space switcher: one dot per starred channel. Rendered
            whenever channels are on so the landing shows the dot row too. */}
        {channelsEnabled && <SpaceDots />}

        {/* Workspace switcher pinned to the bottom. In spaces mode a Configure
            gear sits beside it (per the mockup); otherwise its dropdown still
            carries the Settings entry. */}
        <Box className="shrink-0 px-2 pb-2">
          {channelsEnabled ? (
            <Flex align="center" gap="1">
              <Button
                variant="default"
                size="icon-sm"
                aria-label="Settings"
                onClick={() => openSettings()}
              >
                <GearSixIcon size={14} />
              </Button>
              <Box className="min-w-0 flex-1">
                <ProjectSwitcher />
              </Box>
            </Flex>
          ) : (
            <ProjectSwitcher />
          )}
        </Box>
      </Flex>
    </ResizableSidebar>
  );
}
