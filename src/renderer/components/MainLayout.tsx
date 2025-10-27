import { Box, Flex } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { NotetakerView } from "@/renderer/features/notetaker/components/NotetakerView";
import { RecordingsView } from "@/renderer/features/recordings";
import { useIntegrations } from "../hooks/useIntegrations";
import { useLayoutStore } from "../stores/layoutStore";
import { useTabStore } from "../stores/tabStore";
import { CommandMenu } from "./command";
import { MainSidebar } from "./MainSidebar";
import { SettingsView } from "./SettingsView";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { TaskDetail } from "./tasks/TaskDetail";
import { TaskList } from "./tasks/TaskList";
import { UpdatePrompt } from "./UpdatePrompt";

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
    </Flex>
  );
}
