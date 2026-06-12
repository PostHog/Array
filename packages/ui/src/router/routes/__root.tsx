import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import {
  BILLING_FLAG,
  HOME_TAB_FLAG,
  PROJECT_BLUEBIRD_FLAG,
  SYNC_CLOUD_TASKS_FLAG,
} from "@posthog/shared";
import { UsageLimitModal } from "@posthog/ui/features/billing/UsageLimitModal";
import { AppNav } from "@posthog/ui/features/canvas/components/AppNav";
import { ChannelsList } from "@posthog/ui/features/canvas/components/ChannelsList";
import { CommandMenu } from "@posthog/ui/features/command/CommandMenu";
import { KeyboardShortcutsSheet } from "@posthog/ui/features/command/KeyboardShortcutsSheet";
import { useNewTaskDeepLink } from "@posthog/ui/features/deep-links/useNewTaskDeepLink";
import { useTaskDeepLink } from "@posthog/ui/features/deep-links/useTaskDeepLink";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useInboxDeepLink } from "@posthog/ui/features/inbox/hooks/useInboxDeepLink";
import { useIntegrations } from "@posthog/ui/features/integrations/useIntegrations";
import { useSetupDiscovery } from "@posthog/ui/features/setup/useSetupDiscovery";
import { MainSidebar } from "@posthog/ui/features/sidebar/components/MainSidebar";
import { useSidebarData } from "@posthog/ui/features/sidebar/useSidebarData";
import { useVisualTaskOrder } from "@posthog/ui/features/sidebar/useVisualTaskOrder";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { TourOverlay } from "@posthog/ui/features/tour/components/TourOverlay";
import { useWorkspaces } from "@posthog/ui/features/workspace/useWorkspace";
import { useAppView } from "@posthog/ui/router/useAppView";
import { openTask, openTaskInput } from "@posthog/ui/router/useOpenTask";
import { useCommandMenuStore } from "@posthog/ui/shell/commandMenuStore";
import { GlobalEventHandlers } from "@posthog/ui/shell/GlobalEventHandlers";
import { HeaderRow } from "@posthog/ui/shell/HeaderRow";
import { HedgehogMode } from "@posthog/ui/shell/HedgehogMode";
import { logger } from "@posthog/ui/shell/logger";
import { onFeatureFlagsLoaded } from "@posthog/ui/shell/posthogAnalyticsImpl";
import { SpaceSwitcher } from "@posthog/ui/shell/SpaceSwitcher";
import { useShortcutsSheetStore } from "@posthog/ui/shell/shortcutsSheetStore";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useQueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  Outlet,
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
        !reconcilingTaskIds.current.has(t.id),
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
      <Flex height="100vh">
        <AppNav />
        <Flex direction="column" flexGrow="1" overflow="hidden">
          <Flex flexGrow="1" overflow="hidden">
            <Flex
              direction="column"
              className="w-[260px] shrink-0 border-gray-6 border-r bg-gray-2"
            >
              {/* Aligns the channel list with the outlet's breadcrumb bar (same
                  h-10) so both columns start at the same line, like /code. */}
              <Flex
                align="center"
                className="h-10 shrink-0 border-gray-6 border-b px-3"
              >
                <Text size="1" weight="medium" className="text-gray-12">
                  Channels
                </Text>
              </Flex>
              <Box className="min-h-0 flex-1 overflow-hidden">
                <ChannelsList />
              </Box>
            </Flex>
            <Box flexGrow="1" overflow="hidden">
              <Outlet />
            </Box>
          </Flex>
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
      {bluebirdEnabled && <AppNav />}
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
