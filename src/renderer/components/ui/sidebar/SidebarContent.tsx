import { Box } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useAudioRecorder } from "../../../features/recordings/hooks/useAudioRecorder";
import { useRecordings } from "../../../features/recordings/hooks/useRecordings";
import { useAuthStore } from "../../../stores/authStore";
import { useLayoutStore } from "../../../stores/layoutStore";
import { useSidebarStore } from "../../../stores/sidebarStore";
import { useTabStore } from "../../../stores/tabStore";
import { SidebarTreeItem } from "./SidebarTreeItem";
import { useSidebarMenuData } from "./UseSidebarMenuData";
import { buildTreeLines } from "./Utils";

export const SidebarContent: React.FC = () => {
  const { client } = useAuthStore();
  const { tabs, createTab, setActiveTab, activeTabId } = useTabStore();
  const { expandedNodes: expandedNodesArray, toggleNode } = useSidebarStore();
  const { setCliMode } = useLayoutStore();
  const { saveRecording } = useRecordings();
  const { startRecording, stopRecording } = useAudioRecorder(saveRecording);
  const [userName, setUserName] = useState<string>("Loading...");
  const [hoveredLineIndex, setHoveredLineIndex] = useState<number | null>(null);

  const expandedNodes = useMemo(
    () => new Set(expandedNodesArray),
    [expandedNodesArray],
  );
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  useEffect(() => {
    async function fetchUser() {
      if (client) {
        try {
          const user = await client.getCurrentUser();
          setUserName(user.first_name || user.email || "Account");
        } catch (error) {
          console.error("Failed to fetch user:", error);
          setUserName("Account");
        }
      }
    }
    fetchUser();
  }, [client]);

  const handleNavigate = (
    type: "task-list" | "recordings" | "settings",
    title: string,
  ) => {
    const existingTab = tabs.find((tab) => tab.type === type);
    if (existingTab) {
      setActiveTab(existingTab.id);
    } else {
      createTab({ type, title });
    }
  };

  const handleTaskClick = (task: Task) => {
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

  const handleStartRecording = () => {
    handleNavigate("recordings", "Recordings");
    startRecording();
  };

  const handleStopRecording = () => {
    stopRecording();
  };

  const handleCreateTask = () => {
    handleNavigate("task-list", "Tasks");
    setCliMode("task");
  };

  const menuData = useSidebarMenuData({
    userName,
    activeTab,
    onNavigate: handleNavigate,
    onTaskClick: handleTaskClick,
    onCreateTask: handleCreateTask,
    onStartRecording: handleStartRecording,
    onStopRecording: handleStopRecording,
  });

  const treeLines = buildTreeLines([menuData], "", "", expandedNodes, 0);

  return (
    <Box
      style={{
        flexGrow: 1,
        overflow: "auto",
      }}
    >
      <Box p="2">
        <div className="sidebar-tree">
          {treeLines.map((line, index) => (
            <SidebarTreeItem
              key={line.nodeId}
              line={line}
              index={index}
              isHovered={hoveredLineIndex === index}
              expandedNodes={expandedNodes}
              onMouseEnter={() => setHoveredLineIndex(index)}
              onMouseLeave={() => setHoveredLineIndex(null)}
              onToggle={toggleNode}
            />
          ))}
        </div>
      </Box>
    </Box>
  );
};
