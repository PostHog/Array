import { MainSidebar } from "@components/MainSidebar";
import { StatusBar } from "@components/StatusBar";
import { TabBar } from "@components/TabBar";
import { UpdatePrompt } from "@components/UpdatePrompt";
import { CommandMenu } from "@features/command/components/CommandMenu";
import { RecordingsView } from "@features/recordings/components/RecordingsView";
import { SettingsView } from "@features/settings/components/SettingsView";
import { TaskDetail } from "@features/tasks/components/TaskDetail";
import { TaskList } from "@features/tasks/components/TaskList";
import { useIntegrations } from "@hooks/useIntegrations";
import { Box, Flex } from "@radix-ui/themes";
import { trackTaskView } from "@renderer/lib/analytics";
import type { Task } from "@shared/types";
import { useLayoutStore } from "@stores/layoutStore";
import { useTabStore } from "@stores/tabStore";
import { useCallback, useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Toaster } from "sonner";
import { NotetakerView } from "@/renderer/features/notetaker/components/NotetakerView";

export function MainLayout() {
  const { activeTabId, tabs, createTab, setActiveTab, closeTab } =
    useTabStore();
  const { setCliMode } = useLayoutStore();
  useIntegrations();
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);

  const handleOpenSettings = useCallback(() => {
    const existingTab = tabs.find((tab) => tab.type === "settings");

    if (existingTab) {
      if (activeTabId === existingTab.id) {
        closeTab(existingTab.id);
      } else {
        setActiveTab(existingTab.id);
      }
    } else {
      createTab({
        type: "settings",
        title: "Settings",
      });
    }
  }, [tabs, activeTabId, setActiveTab, createTab, closeTab]);

  const handleFocusTaskMode = useCallback(() => {
    // Find the Tasks tab or use the first task-list tab
    const tasksTab = tabs.find((tab) => tab.type === "task-list");

    if (tasksTab) {
      setActiveTab(tasksTab.id);
    }

    // Switch to task mode
    setCliMode("task");

    // Note: The auto-focus effect in CliTaskPanel will handle focusing the editor
  }, [tabs, setActiveTab, setCliMode]);

  useHotkeys("mod+k", () => setCommandMenuOpen((prev) => !prev), {
    enabled: !commandMenuOpen,
  });
  useHotkeys("mod+t", () => setCommandMenuOpen((prev) => !prev), {
    enabled: !commandMenuOpen,
  });
  useHotkeys("mod+p", () => setCommandMenuOpen((prev) => !prev), {
    enabled: !commandMenuOpen,
  });
  useHotkeys("mod+n", () => handleFocusTaskMode());
  useHotkeys("mod+,", () => handleOpenSettings());

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onOpenSettings(() => {
      handleOpenSettings();
    });

    return () => {
      unsubscribe?.();
    };
  }, [handleOpenSettings]);

  const handleSelectTask = (task: Task) => {
    const existingTab = tabs.find(
      (tab) =>
        tab.type === "task-detail" &&
        tab.data &&
        typeof tab.data === "object" &&
        "id" in tab.data &&
        tab.data.id === task.id,
    );

    if (existingTab) {
      setActiveTab(existingTab.id);
    } else {
      createTab({
        type: "task-detail",
        title: task.title,
        data: task,
      });

      // Track task view
      trackTaskView({
        task_id: task.id,
        has_repository: !!task.repository_config,
      });
    }
  };

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  return (
    <Flex direction="column" height="100vh">
      <TabBar onOpenCommandMenu={() => setCommandMenuOpen(true)} />

      <Flex flexGrow="1" overflow="hidden">
        <MainSidebar />

        <Box flexGrow="1" overflow="hidden">
          {activeTab?.type === "task-list" && (
            <TaskList onSelectTask={handleSelectTask} />
          )}

          {activeTab?.type === "task-detail" && activeTab.data ? (
            <TaskDetail task={activeTab.data as Task} />
          ) : null}

          {activeTab?.type === "settings" && <SettingsView />}

          {activeTab?.type === "recordings" && <RecordingsView />}

          {activeTab?.type === "notetaker" && <NotetakerView />}
        </Box>
      </Flex>

      <StatusBar onOpenSettings={handleOpenSettings} />

      <CommandMenu open={commandMenuOpen} onOpenChange={setCommandMenuOpen} />
      <UpdatePrompt />
      <Toaster position="bottom-right" />
    </Flex>
  );
}
