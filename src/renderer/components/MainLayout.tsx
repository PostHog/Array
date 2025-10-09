import { Box, Flex } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useAuthStore } from "../stores/authStore";
import { useTabStore } from "../stores/tabStore";
import { CommandMenu } from "./command";
import { RecordingsView } from "./RecordingsView";
import { SourcesView } from "./SourcesView";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { TaskCreate } from "./TaskCreate";
import { TaskDetail } from "./TaskDetail";
import { TaskList } from "./TaskList";
import { WorkflowView } from "./WorkflowView";

export function MainLayout() {
  const { enabledSources } = useAuthStore();
  const { activeTabId, tabs, createTab, setActiveTab, initializeTabs } =
    useTabStore();
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [startRecordingTrigger, setStartRecordingTrigger] = useState(0);

  // Initialize tabs based on enabled sources
  useEffect(() => {
    initializeTabs(enabledSources);
  }, [enabledSources, initializeTabs]);

  // Listen for meeting detection notifications
  useEffect(() => {
    if (!window.electronAPI.onMeetingDetected) {
      return;
    }

    const cleanup = window.electronAPI.onMeetingDetected(() => {
      // Switch to recordings tab
      const recordingsTab = tabs.find((tab) => tab.type === "recordings");
      if (recordingsTab) {
        setActiveTab(recordingsTab.id);
      }

      // Trigger recording start
      setStartRecordingTrigger((prev) => prev + 1);
    });

    return () => {
      cleanup();
    };
  }, [tabs, setActiveTab]);

  useHotkeys("mod+k", () => setCommandMenuOpen((prev) => !prev), {
    enabled: !commandMenuOpen,
  });
  useHotkeys("mod+t", () => setCommandMenuOpen((prev) => !prev), {
    enabled: !commandMenuOpen,
  });
  useHotkeys("mod+p", () => setCommandMenuOpen((prev) => !prev), {
    enabled: !commandMenuOpen,
  });
  useHotkeys("mod+n", () => setTaskCreateOpen(true));

  // Keyboard shortcuts for tabs
  useHotkeys("mod+1", () => {
    const tasksTab = tabs.find((tab) => tab.type === "task-list");
    if (tasksTab) setActiveTab(tasksTab.id);
  });

  useHotkeys("mod+2", () => {
    const workflowTab = tabs.find((tab) => tab.type === "workflow");
    if (workflowTab) setActiveTab(workflowTab.id);
  });

  useHotkeys("mod+3", () => {
    const sourcesTab = tabs.find((tab) => tab.type === "sources");
    if (sourcesTab) {
      setActiveTab(sourcesTab.id);
    } else {
      createTab({ type: "sources", title: "Sources" });
    }
  });

  useHotkeys("mod+4", () => {
    const recordingsTab = tabs.find((tab) => tab.type === "recordings");
    if (recordingsTab) setActiveTab(recordingsTab.id);
  });

  const handleSelectTask = (task: Task) => {
    // Check if task is already open in a tab
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
      <TabBar />

      <Box flexGrow="1" overflow="hidden">
        {activeTab?.type === "task-list" && (
          <TaskList
            onSelectTask={handleSelectTask}
            onNewTask={() => setTaskCreateOpen(true)}
          />
        )}

        {activeTab?.type === "task-detail" && activeTab.data ? (
          <TaskDetail task={activeTab.data as Task} />
        ) : null}

        {activeTab?.type === "workflow" && (
          <WorkflowView onSelectTask={handleSelectTask} />
        )}

        {activeTab?.type === "sources" && <SourcesView />}

        {activeTab?.type === "recordings" && (
          <RecordingsView startRecordingTrigger={startRecordingTrigger} />
        )}
      </Box>

      <StatusBar />

      <CommandMenu
        open={commandMenuOpen}
        onOpenChange={setCommandMenuOpen}
        onCreateTask={() => setTaskCreateOpen(true)}
      />
      <TaskCreate open={taskCreateOpen} onOpenChange={setTaskCreateOpen} />
    </Flex>
  );
}
