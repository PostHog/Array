import { HeaderRow } from "@components/HeaderRow";
import { HedgehogMode } from "@components/HedgehogMode";
import { KeyboardShortcutsSheet } from "@components/KeyboardShortcutsSheet";
import { SpaceSwitcher } from "@components/SpaceSwitcher";
import { UsageLimitModal } from "@features/billing/components/UsageLimitModal";
import { CommandMenu } from "@features/command/components/CommandMenu";
import { useInboxDeepLink } from "@features/inbox/hooks/useInboxDeepLink";
import { useSetupDiscovery } from "@features/setup/hooks/useSetupDiscovery";
import { MainSidebar } from "@features/sidebar/components/MainSidebar";
import { useSidebarData } from "@features/sidebar/hooks/useSidebarData";
import { useVisualTaskOrder } from "@features/sidebar/hooks/useVisualTaskOrder";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { TourOverlay } from "@features/tour/components/TourOverlay";
import {
  useWorkspaces,
  workspaceApi,
} from "@features/workspace/hooks/useWorkspace";
import { useAppView } from "@hooks/useAppView";
import { useFeatureFlag } from "@hooks/useFeatureFlag";
import { useIntegrations } from "@hooks/useIntegrations";
import { openTask, openTaskInput } from "@hooks/useOpenTask";
import { Box, Flex } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc/client";
import { BILLING_FLAG, SYNC_CLOUD_TASKS_FLAG } from "@shared/constants";
import { useCommandMenuStore } from "@stores/commandMenuStore";
import { useShortcutsSheetStore } from "@stores/shortcutsSheetStore";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { logger } from "@utils/logger";
import { lazy, Suspense, useCallback, useEffect, useRef } from "react";

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

import { GlobalEventHandlers } from "../components/GlobalEventHandlers";
import { useNewTaskDeepLink } from "../hooks/useNewTaskDeepLink";
import { useTaskDeepLink } from "../hooks/useTaskDeepLink";

const log = logger.scope("root-route");

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
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
    toggle: toggleShortcutsSheet,
    close: closeShortcutsSheet,
  } = useShortcutsSheetStore();
  const { data: tasks } = useTasks();
  const { data: workspaces, isFetched: workspacesFetched } = useWorkspaces();
  const trpcReact = useTRPC();
  const queryClient = useQueryClient();
  const reconcilingTaskIds = useRef<Set<string>>(new Set());
  const billingEnabled = useFeatureFlag(BILLING_FLAG);
  const syncCloudTasksEnabled = useFeatureFlag(SYNC_CLOUD_TASKS_FLAG);

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
  // task cache populates view.data automatically.

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
    workspaceApi
      .reconcileCloudWorkspaces(missingIds)
      .then((result) => {
        for (const id of missingIds) reconcilingTaskIds.current.delete(id);
        if (result.created.length > 0) {
          void queryClient.invalidateQueries(
            trpcReact.workspace.getAll.pathFilter(),
          );
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
    trpcReact,
  ]);

  // Note: a malformed /code/tasks/$taskId without a valid id is impossible —
  // TanStack Router only mounts the task-detail route when taskId is in the URL.

  const handleToggleCommandMenu = useCallback(() => {
    toggleCommandMenu();
  }, [toggleCommandMenu]);

  // Settings is a full-page route — drop the app chrome (header/sidebar/
  // space-switcher) so the panel occupies the full window.
  const isSettingsRoute = useRouterState({
    select: (s) => s.matches.some((m) => m.routeId.startsWith("/settings")),
  });

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
          onToggleCommandMenu={handleToggleCommandMenu}
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
    <Flex direction="column" height="100vh">
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
        isOnNewTask={view.type === "task-input" || view.type === "task-pending"}
        onNavigateToTask={openTask}
        onNewTask={openTaskInput}
      />
      <CommandMenu open={commandMenuOpen} onOpenChange={setCommandMenuOpen} />
      <KeyboardShortcutsSheet
        open={shortcutsSheetOpen}
        onOpenChange={(open) => (open ? null : closeShortcutsSheet())}
      />
      <GlobalEventHandlers
        onToggleCommandMenu={handleToggleCommandMenu}
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
  );
}
