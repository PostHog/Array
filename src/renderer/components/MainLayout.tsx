import { Box, Flex } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useIntegrationStore } from "../stores/integrationStore";
import { useTabStore } from "../stores/tabStore";
import { CommandMenu } from "./command";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { TaskCreate } from "./TaskCreate";
import { TaskDetail } from "./TaskDetail";
import { TaskList } from "./TaskList";
import { WorkflowForm } from "./WorkflowForm";
import { WorkflowView } from "./WorkflowView";

export function MainLayout() {
  const { activeTabId, tabs, createTab, setActiveTab } = useTabStore();
  const { fetchIntegrations } = useIntegrationStore();
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [workflowCreateOpen, setWorkflowCreateOpen] = useState(false);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

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
  useHotkeys("mod+shift+n", () => setWorkflowCreateOpen(true));

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
            onNewWorkflow={() => setWorkflowCreateOpen(true)}
          />
        )}

        {activeTab?.type === "task-detail" && activeTab.data ? (
          <TaskDetail task={activeTab.data as Task} />
        ) : null}

        {activeTab?.type === "workflow" && (
          <WorkflowView onSelectTask={handleSelectTask} />
        )}
      </Box>

      <StatusBar />

      <CommandMenu
        open={commandMenuOpen}
        onOpenChange={setCommandMenuOpen}
        onCreateTask={() => setTaskCreateOpen(true)}
      />
      <TaskCreate open={taskCreateOpen} onOpenChange={setTaskCreateOpen} />
      <WorkflowForm
        open={workflowCreateOpen}
        onOpenChange={setWorkflowCreateOpen}
      />
    </Flex>
  );
}
