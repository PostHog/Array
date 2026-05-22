import { HeaderRow } from "@components/HeaderRow";
import { HedgehogMode } from "@components/HedgehogMode";
import { KeyboardShortcutsSheet } from "@components/KeyboardShortcutsSheet";
import { SpaceSwitcher } from "@components/SpaceSwitcher";

import { ArchivedTasksView } from "@features/archive/components/ArchivedTasksView";
import { UsageLimitModal } from "@features/billing/components/UsageLimitModal";
import { useUsageLimitDetection } from "@features/billing/hooks/useUsageLimitDetection";
import { CommandMenu } from "@features/command/components/CommandMenu";
import { CommandCenterView } from "@features/command-center/components/CommandCenterView";
import { InboxView } from "@features/inbox/components/InboxView";
import { useInboxDeepLink } from "@features/inbox/hooks/useInboxDeepLink";
import { McpServersView } from "@features/mcp-servers/components/McpServersView";
import { FolderSettingsView } from "@features/settings/components/FolderSettingsView";
import { SettingsDialog } from "@features/settings/components/SettingsDialog";
import { useSetupDiscovery } from "@features/setup/hooks/useSetupDiscovery";
import { MainSidebar } from "@features/sidebar/components/MainSidebar";
import { useSidebarData } from "@features/sidebar/hooks/useSidebarData";
import { useVisualTaskOrder } from "@features/sidebar/hooks/useVisualTaskOrder";
import { SkillsView } from "@features/skills/components/SkillsView";
import { TaskDetail } from "@features/task-detail/components/TaskDetail";
import { TaskInput } from "@features/task-detail/components/TaskInput";
import { TaskPendingView } from "@features/task-detail/components/TaskPendingView";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { TourOverlay } from "@features/tour/components/TourOverlay";
import {
  useWorkspaces,
  workspaceApi,
} from "@features/workspace/hooks/useWorkspace";
import { useFeatureFlag } from "@hooks/useFeatureFlag";
import { useIntegrations } from "@hooks/useIntegrations";
import { Box, Flex } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc/client";
import { BILLING_FLAG, SYNC_CLOUD_TASKS_FLAG } from "@shared/constants";
import { useCommandMenuStore } from "@stores/commandMenuStore";
import { useNavigationStore } from "@stores/navigationStore";
import { useShortcutsSheetStore } from "@stores/shortcutsSheetStore";
import { useQueryClient } from "@tanstack/react-query";
import { logger } from "@utils/logger";
import { useCallback, useEffect, useRef } from "react";
import { useTaskDeepLink } from "../hooks/useTaskDeepLink";
import { GlobalEventHandlers } from "./GlobalEventHandlers";

const log = logger.scope("main-layout");

export function MainLayout() {
  const {
    view,
    hydrateTask,
    navigateToTaskInput,
    navigateToTask,
    taskInputReportAssociation,
    taskInputCloudRepository,
  } = useNavigationStore();
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

  // Space switcher data
  const sidebarData = useSidebarData({ activeView: view });
  const visualTaskOrder = useVisualTaskOrder(sidebarData);
  const activeTaskId =
    view.type === "task-detail" && view.data ? view.data.id : null;

  useUsageLimitDetection(billingEnabled);
  useIntegrations();
  useTaskDeepLink();
  useInboxDeepLink();
  useSetupDiscovery();

  useEffect(() => {
    if (tasks) {
      hydrateTask(tasks);
    }
  }, [tasks, hydrateTask]);

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

  useEffect(() => {
    if (view.type === "task-detail" && !view.data && !view.taskId) {
      navigateToTaskInput();
    }
  }, [view, navigateToTaskInput]);

  const handleToggleCommandMenu = useCallback(() => {
    toggleCommandMenu();
  }, [toggleCommandMenu]);

  return (
    <Flex direction="column" height="100vh">
      <HeaderRow />
      <Flex flexGrow="1" overflow="hidden">
        <MainSidebar />

        <Box flexGrow="1" overflow="hidden">
          {view.type === "task-input" && (
            <TaskInput
              initialPrompt={view.initialPrompt}
              initialPromptKey={view.taskInputRequestId}
              initialCloudRepository={
                view.initialCloudRepository ?? taskInputCloudRepository
              }
              reportAssociation={
                view.reportAssociation ?? taskInputReportAssociation
              }
            />
          )}

          {view.type === "task-detail" && view.data && (
            <TaskDetail key={view.data.id} task={view.data} />
          )}

          {view.type === "task-pending" && view.pendingTaskKey && (
            <TaskPendingView pendingTaskKey={view.pendingTaskKey} />
          )}

          {view.type === "folder-settings" && <FolderSettingsView />}

          {view.type === "inbox" && <InboxView />}

          {view.type === "archived" && <ArchivedTasksView />}

          {view.type === "command-center" && <CommandCenterView />}

          {view.type === "skills" && <SkillsView />}

          {view.type === "mcp-servers" && <McpServersView />}
        </Box>
      </Flex>

      <SpaceSwitcher
        tasks={visualTaskOrder}
        activeTaskId={activeTaskId}
        allTasks={tasks ?? []}
        isOnNewTask={view.type === "task-input" || view.type === "task-pending"}
        onNavigateToTask={navigateToTask}
        onNewTask={navigateToTaskInput}
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
      <SettingsDialog />
      <TourOverlay />
      {billingEnabled && <UsageLimitModal />}
      <HedgehogMode />
    </Flex>
  );
}
