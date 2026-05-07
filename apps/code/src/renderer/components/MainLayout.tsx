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
import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import { SetupView } from "@features/setup/components/SetupView";
import { MainSidebar } from "@features/sidebar/components/MainSidebar";
import { useSidebarData } from "@features/sidebar/hooks/useSidebarData";
import { useVisualTaskOrder } from "@features/sidebar/hooks/useVisualTaskOrder";
import { SkillsView } from "@features/skills/components/SkillsView";
import { TaskDetail } from "@features/task-detail/components/TaskDetail";
import { TaskInput } from "@features/task-detail/components/TaskInput";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { TourOverlay } from "@features/tour/components/TourOverlay";
import { useTourStore } from "@features/tour/stores/tourStore";
import { createFirstTaskTour } from "@features/tour/tours/createFirstTaskTour";
import { useFeatureFlag } from "@hooks/useFeatureFlag";
import { useIntegrations } from "@hooks/useIntegrations";
import { Box, Flex } from "@radix-ui/themes";
import { BILLING_FLAG } from "@shared/constants";
import { useCommandMenuStore } from "@stores/commandMenuStore";
import { useNavigationStore } from "@stores/navigationStore";
import { useShortcutsSheetStore } from "@stores/shortcutsSheetStore";
import { useCallback, useEffect } from "react";
import { useTaskDeepLink } from "../hooks/useTaskDeepLink";
import { GlobalEventHandlers } from "./GlobalEventHandlers";

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
  const billingEnabled = useFeatureFlag(BILLING_FLAG);

  // Space switcher data
  const sidebarData = useSidebarData({ activeView: view });
  const visualTaskOrder = useVisualTaskOrder(sidebarData);
  const activeTaskId =
    view.type === "task-detail" && view.data ? view.data.id : null;

  const startTour = useTourStore((s) => s.startTour);
  const isFirstTaskTourDone = useTourStore((s) =>
    s.completedTourIds.includes(createFirstTaskTour.id),
  );

  useUsageLimitDetection(billingEnabled);
  useIntegrations();
  useTaskDeepLink();
  useInboxDeepLink();

  useEffect(() => {
    if (tasks) {
      hydrateTask(tasks);
    }
  }, [tasks, hydrateTask]);

  useEffect(() => {
    if (view.type === "task-detail" && !view.data && !view.taskId) {
      navigateToTaskInput();
    }
  }, [view, navigateToTaskInput]);

  const settingsOpen = useSettingsDialogStore((s) => s.isOpen);

  useEffect(() => {
    if (isFirstTaskTourDone || settingsOpen) return;
    const timer = setTimeout(() => startTour(createFirstTaskTour.id), 600);
    return () => clearTimeout(timer);
  }, [isFirstTaskTourDone, settingsOpen, startTour]);

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

          {view.type === "folder-settings" && <FolderSettingsView />}

          {view.type === "inbox" && <InboxView />}

          {view.type === "archived" && <ArchivedTasksView />}

          {view.type === "command-center" && <CommandCenterView />}

          {view.type === "skills" && <SkillsView />}

          {view.type === "mcp-servers" && <McpServersView />}
          {view.type === "setup" && <SetupView />}
        </Box>
      </Flex>

      <SpaceSwitcher
        tasks={visualTaskOrder}
        activeTaskId={activeTaskId}
        allTasks={tasks ?? []}
        isOnNewTask={view.type === "task-input"}
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
