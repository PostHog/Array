import {
  ArrowSquareOut,
  CaretLeftIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import { Button } from "@posthog/quill";
import {
  BILLING_FLAG,
  HOME_TAB_FLAG,
  PROJECT_BLUEBIRD_FLAG,
  SYNC_CLOUD_TASKS_FLAG,
} from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { isContentlessTask } from "@posthog/shared/domain-types";
import { DeepLinkApprovalModal } from "@posthog/ui/features/agent-applications/components/DeepLinkApprovalModal";
import { useApprovalDeepLink } from "@posthog/ui/features/agent-applications/hooks/useApprovalDeepLink";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { UsageLimitModal } from "@posthog/ui/features/billing/UsageLimitModal";
import { ChannelsSidebar } from "@posthog/ui/features/canvas/components/ChannelsSidebar";
import {
  FeedbackModal,
  type FeedbackModalMode,
} from "@posthog/ui/features/canvas/components/FeedbackModal";
import { CommandMenu } from "@posthog/ui/features/command/CommandMenu";
import { KeyboardShortcutsSheet } from "@posthog/ui/features/command/KeyboardShortcutsSheet";
import { useNewTaskDeepLink } from "@posthog/ui/features/deep-links/useNewTaskDeepLink";
import { useTaskDeepLink } from "@posthog/ui/features/deep-links/useTaskDeepLink";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useInboxDeepLink } from "@posthog/ui/features/inbox/hooks/useInboxDeepLink";
import { useIntegrations } from "@posthog/ui/features/integrations/useIntegrations";
import { useScoutDeepLink } from "@posthog/ui/features/scouts/hooks/useScoutDeepLink";
import { useSetupDiscovery } from "@posthog/ui/features/setup/useSetupDiscovery";
import { MainSidebar } from "@posthog/ui/features/sidebar/components/MainSidebar";
import { useSidebarData } from "@posthog/ui/features/sidebar/useSidebarData";
import { useVisualTaskOrder } from "@posthog/ui/features/sidebar/useVisualTaskOrder";
import { ExistingWorktreeDialog } from "@posthog/ui/features/task-detail/components/ExistingWorktreeDialog";
import { RemoteBranchCheckoutDialog } from "@posthog/ui/features/task-detail/components/RemoteBranchCheckoutDialog";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { TourOverlay } from "@posthog/ui/features/tour/components/TourOverlay";
import { useWorkspaces } from "@posthog/ui/features/workspace/useWorkspace";
import LogosLandscape from "@posthog/ui/primitives/Logo";
import { useAppView } from "@posthog/ui/router/useAppView";
import { openTask, openTaskInput } from "@posthog/ui/router/useOpenTask";
import { track } from "@posthog/ui/shell/analytics";
import { useCommandMenuStore } from "@posthog/ui/shell/commandMenuStore";
import { GlobalEventHandlers } from "@posthog/ui/shell/GlobalEventHandlers";
import { HeaderRow } from "@posthog/ui/shell/HeaderRow";
import { HedgehogMode } from "@posthog/ui/shell/HedgehogMode";
import { logger } from "@posthog/ui/shell/logger";
import { onFeatureFlagsLoaded } from "@posthog/ui/shell/posthogAnalyticsImpl";
import { SpaceSwitcher } from "@posthog/ui/shell/SpaceSwitcher";
import { useShortcutsSheetStore } from "@posthog/ui/shell/shortcutsSheetStore";
import { openUrlInBrowser } from "@posthog/ui/utils/browser";
import { getPostHogUrl } from "@posthog/ui/utils/urls";
import { Box, Flex } from "@radix-ui/themes";
import { useQueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  Outlet,
  useCanGoBack,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

// Dynamic import keeps the devtools chunk out of the prod bundle. Without the
// gate at the import level, conditional render alone still ships the devtools
// code to users.
//
// We embed the router devtools as a plugin inside the unified TanStack Devtools
// shell rather than rendering the standalone floating logo. The shell owns a
// single trigger that can be dragged, dismissed, and hidden-until-hover, and it
// persists those choices to localStorage — so the panel stays out of the way.
const TanStackDevtools = import.meta.env.DEV
  ? lazy(async () => {
      const [
        { TanStackDevtools: DevtoolsShell },
        { TanStackRouterDevtoolsPanel },
      ] = await Promise.all([
        import("@tanstack/react-devtools"),
        import("@tanstack/react-router-devtools"),
      ]);
      // Hoisted so the config/plugins keep stable references across the
      // RootLayout re-renders that fire on every navigation — otherwise the
      // shell could remount the panel (and flash) on each route change.
      const config = {
        position: "bottom-right",
        hideUntilHover: true,
      } as const;
      const plugins = [
        {
          name: "TanStack Router",
          render: <TanStackRouterDevtoolsPanel />,
        },
      ];
      return {
        default: () => <DevtoolsShell config={config} plugins={plugins} />,
      };
    })
  : () => null;

const log = logger.scope("root-route");

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const view = useAppView();
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  // Forward availability isn't exposed by the router (and history.length counts
  // pre-app entries, so it can't be compared to __TSR_index). Track the newest
  // index we've reached: only a PUSH wipes the forward stack, so it resets the
  // newest to the current index. REPLACE mutates the current entry in place
  // (index unchanged, forward entries intact) and BACK/GO just move within the
  // existing stack, so both keep the max. Forward is live while below it.
  const historyIndex = useRouterState({
    select: (s) => s.location.state.__TSR_index,
  });
  const [newestIndex, setNewestIndex] = useState(historyIndex);
  useEffect(() => {
    return router.history.subscribe(({ location, action }) => {
      const idx = location.state.__TSR_index;
      setNewestIndex((prev) =>
        action.type === "PUSH" ? idx : Math.max(prev, idx),
      );
    });
  }, [router]);
  const canGoForward = historyIndex < newestIndex;

  // Feedback modal shown in the Channels title bar. Opened directly by "Leave
  // feedback" (mode "feedback"), or as an intercept before navigating away —
  // "Go back to Code" (mode "leaving") and "PostHog Web" (mode "posthog-web"),
  // each of which routes once the modal is submitted or skipped.
  const [feedbackMode, setFeedbackMode] = useState<FeedbackModalMode | null>(
    null,
  );
  const currentProjectId = useAuthStateValue((s) => s.currentProjectId);

  // The user's current project on the correct cloud (region comes from
  // cloudRegion via getPostHogUrl), falling back to the account root. `null`
  // when the region is unknown — the "PostHog Web" button is disabled then, so
  // a click can never silently no-op.
  const posthogWebUrl = getPostHogUrl(
    currentProjectId ? `/project/${currentProjectId}` : "/",
  );

  // Both "Go back to Code" and "PostHog Web" open the feedback modal first and
  // perform their navigation only once it's submitted or skipped.
  const handleFeedbackFinished = () => {
    const finishedMode = feedbackMode;
    setFeedbackMode(null);
    if (finishedMode === "leaving") {
      navigate({ to: "/code" });
    } else if (finishedMode === "posthog-web" && posthogWebUrl) {
      void openUrlInBrowser(posthogWebUrl);
    }
  };

  const handleOpenPostHogWeb = () => {
    track(ANALYTICS_EVENTS.POSTHOG_WEB_OPENED);
    setFeedbackMode("posthog-web");
  };
  const {
    isOpen: commandMenuOpen,
    setOpen: setCommandMenuOpen,
    toggle: toggleCommandMenu,
  } = useCommandMenuStore();
  const {
    isOpen: shortcutsSheetOpen,
    close: closeShortcutsSheet,
    toggle: toggleShortcutsSheet,
  } = useShortcutsSheetStore();
  const { data: tasks } = useTasks();
  const { data: workspaces, isFetched: workspacesFetched } = useWorkspaces();
  const trpc = useHostTRPC();
  const hostClient = useHostTRPCClient();
  const queryClient = useQueryClient();
  const reconcilingTaskIds = useRef<Set<string>>(new Set());
  const billingEnabled = useFeatureFlag(BILLING_FLAG);
  const syncCloudTasksEnabled = useFeatureFlag(SYNC_CLOUD_TASKS_FLAG);
  const homeTabEnabled = useFeatureFlag(HOME_TAB_FLAG);

  const sidebarData = useSidebarData({ activeView: view });
  const visualTaskOrder = useVisualTaskOrder(sidebarData);
  const activeTaskId =
    view.type === "task-detail" && view.taskId ? view.taskId : null;

  useIntegrations();
  useTaskDeepLink();
  useInboxDeepLink();
  useScoutDeepLink();
  const approvalDeepLink = useApprovalDeepLink();
  useSetupDiscovery();
  useNewTaskDeepLink();

  // hydrateTask is no longer needed — the URL is the source of truth and the
  // task cache populates the route automatically.

  useEffect(() => {
    if (!syncCloudTasksEnabled) return;
    if (!tasks || !workspaces || !workspacesFetched) return;
    const missing = tasks.filter(
      (t) =>
        t.latest_run?.environment === "cloud" &&
        !workspaces[t.id] &&
        !reconcilingTaskIds.current.has(t.id) &&
        !isContentlessTask(t),
    );
    if (missing.length === 0) return;
    const missingIds = missing.map((t) => t.id);
    for (const id of missingIds) reconcilingTaskIds.current.add(id);
    // Single batched IPC instead of one mutation per task — with many cloud
    // tasks the per-task pattern saturates the main thread at boot.
    hostClient.workspace.reconcileCloudWorkspaces
      .mutate({ taskIds: missingIds })
      .then((result) => {
        for (const id of missingIds) reconcilingTaskIds.current.delete(id);
        if (result.created.length > 0) {
          void queryClient.invalidateQueries({
            queryKey: trpc.workspace.getAll.queryKey(),
          });
        }
      })
      .catch((err) => {
        for (const id of missingIds) reconcilingTaskIds.current.delete(id);
        log.warn("Failed to reconcile cloud workspaces", err);
      });
  }, [
    syncCloudTasksEnabled,
    tasks,
    workspaces,
    workspacesFetched,
    queryClient,
    hostClient,
    trpc,
  ]);

  // The /code/home route is only reachable while the home-tab flag is on, but
  // flags resolve asynchronously – a restored route (or a flag flipping off
  // mid-session) can leave us on home without access. Redirect to the new-task
  // screen once flags have loaded and home is gated off.
  const [flagsLoaded, setFlagsLoaded] = useState(false);
  useEffect(() => onFeatureFlagsLoaded(() => setFlagsLoaded(true)), []);
  useEffect(() => {
    if (flagsLoaded && !homeTabEnabled && view.type === "home") {
      openTaskInput();
    }
  }, [flagsLoaded, homeTabEnabled, view.type]);

  // Settings is a full-page route — drop the app chrome (header/sidebar/
  // space-switcher) so the panel occupies the full window.
  const isSettingsRoute = useRouterState({
    select: (s) => s.matches.some((m) => m.routeId.startsWith("/settings")),
  });

  // The canvas "Channels" space (gated by project-bluebird). It owns its own
  // layout (channel sidebar + content via WebsiteLayout), so it drops the Code
  // chrome (header / main sidebar / space-switcher) and shows only the app rail.
  const bluebirdEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const onWebsitePath = useRouterState({
    select: (s) =>
      s.location.pathname === "/website" ||
      s.location.pathname.startsWith("/website/"),
  });
  const isChannelsSpace = bluebirdEnabled && onWebsitePath;

  // The /website (Channels) routes stay registered regardless of the flag, so a
  // stale URL or restored session could strand a flag-off user there (rendering
  // the channel layout inside the Code chrome). Once flags resolve, redirect
  // them back to Code so the off state is indistinguishable from before canvas.
  useEffect(() => {
    if (flagsLoaded && !bluebirdEnabled && onWebsitePath) {
      openTaskInput();
    }
  }, [flagsLoaded, bluebirdEnabled, onWebsitePath]);

  if (isChannelsSpace) {
    return (
      <Flex direction="column" height="100vh" className="bg-chrome">
        {/* Full-width title bar: a window-drag region carrying the PostHog
            mark. The left padding clears the macOS stoplights. */}
        <Flex align="center" gap="3" className="drag h-10 shrink-0 pl-[78px]">
          <Box className="h-[14px] w-[26px] overflow-hidden [&>svg]:h-[14px] [&>svg]:w-auto">
            <LogosLandscape code={false} />
          </Box>
          <Flex align="center" gap="2" className="no-drag">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Back"
              disabled={!canGoBack}
              onClick={() => router.history.back()}
            >
              <CaretLeftIcon size={14} />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Forward"
              disabled={!canGoForward}
              onClick={() => router.history.forward()}
            >
              <CaretRightIcon size={14} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
                  action_type: "leave_space",
                  surface: "title_bar",
                });
                setFeedbackMode("leaving");
              }}
            >
              Go back to Code
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
                  action_type: "leave_feedback",
                  surface: "title_bar",
                });
                setFeedbackMode("feedback");
              }}
            >
              Leave feedback
            </Button>
          </Flex>
          <Flex align="center" className="no-drag ml-auto pr-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!posthogWebUrl}
              onClick={handleOpenPostHogWeb}
            >
              <ArrowSquareOut size={14} />
              PostHog Web
            </Button>
          </Flex>
        </Flex>
        <Flex flexGrow="1" overflow="hidden">
          <ChannelsSidebar />
          {/* Content sits in a bordered, rounded card inset from the window
              edges — the framed pane from the design. */}
          <Box flexGrow="1" className="overflow-hidden">
            <Box className="h-full overflow-hidden rounded-tl-sm border-border border-t border-l bg-background">
              <Outlet />
            </Box>
          </Box>
        </Flex>
        <CommandMenu open={commandMenuOpen} onOpenChange={setCommandMenuOpen} />
        <KeyboardShortcutsSheet
          open={shortcutsSheetOpen}
          onOpenChange={(open) => (open ? null : closeShortcutsSheet())}
        />
        <GlobalEventHandlers
          onToggleCommandMenu={toggleCommandMenu}
          onToggleShortcutsSheet={toggleShortcutsSheet}
        />
        {billingEnabled && <UsageLimitModal />}
        <RemoteBranchCheckoutDialog />
        <FeedbackModal
          mode={feedbackMode}
          onFinished={handleFeedbackFinished}
        />
        <ExistingWorktreeDialog />
        {import.meta.env.DEV && (
          <Suspense fallback={null}>
            <TanStackDevtools />
          </Suspense>
        )}
      </Flex>
    );
  }

  if (isSettingsRoute) {
    return (
      <Flex direction="column" height="100vh">
        <Outlet />
        <CommandMenu open={commandMenuOpen} onOpenChange={setCommandMenuOpen} />
        <KeyboardShortcutsSheet
          open={shortcutsSheetOpen}
          onOpenChange={(open) => (open ? null : closeShortcutsSheet())}
        />
        <GlobalEventHandlers
          onToggleCommandMenu={toggleCommandMenu}
          onToggleShortcutsSheet={toggleShortcutsSheet}
        />
        {billingEnabled && <UsageLimitModal />}
        <RemoteBranchCheckoutDialog />
        <ExistingWorktreeDialog />
        {import.meta.env.DEV && (
          <Suspense fallback={null}>
            <TanStackDevtools />
          </Suspense>
        )}
      </Flex>
    );
  }

  return (
    <Flex height="100vh">
      <Flex direction="column" flexGrow="1" overflow="hidden">
        <HeaderRow />
        <Flex flexGrow="1" overflow="hidden">
          <MainSidebar />
          <Box flexGrow="1" overflow="hidden">
            <Outlet />
          </Box>
        </Flex>

        <SpaceSwitcher
          tasks={visualTaskOrder}
          activeTaskId={activeTaskId}
          allTasks={tasks ?? []}
          isOnNewTask={
            view.type === "task-input" || view.type === "task-pending"
          }
          onNavigateToTask={openTask}
          onNewTask={openTaskInput}
        />
        <CommandMenu open={commandMenuOpen} onOpenChange={setCommandMenuOpen} />
        <KeyboardShortcutsSheet
          open={shortcutsSheetOpen}
          onOpenChange={(open) => (open ? null : closeShortcutsSheet())}
        />
        <GlobalEventHandlers
          onToggleCommandMenu={toggleCommandMenu}
          onToggleShortcutsSheet={toggleShortcutsSheet}
        />
        <TourOverlay />
        {billingEnabled && <UsageLimitModal />}
        <RemoteBranchCheckoutDialog />
        {approvalDeepLink.pending ? (
          <DeepLinkApprovalModal
            pending={approvalDeepLink.pending}
            onClose={approvalDeepLink.clear}
          />
        ) : null}
        <ExistingWorktreeDialog />
        <HedgehogMode />
        {import.meta.env.DEV && (
          <Suspense fallback={null}>
            <TanStackDevtools />
          </Suspense>
        )}
      </Flex>
    </Flex>
  );
}
