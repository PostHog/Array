import { SidebarTreeItem } from "@components/ui/sidebar/SidebarTreeItem";
import { useSidebarMenuData } from "@components/ui/sidebar/UseSidebarMenuData";
import { buildTreeLines, getAllNodeIds } from "@components/ui/sidebar/Utils";
import { useAuthStore } from "@features/auth/stores/authStore";
import { useAudioRecorder } from "@features/recordings/hooks/useAudioRecorder";
import { useRecordings } from "@features/recordings/hooks/useRecordings";
import { ArrowsInSimpleIcon, ArrowsOutSimpleIcon } from "@phosphor-icons/react";
import { Box, Flex, IconButton, Tooltip } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useLayoutStore } from "@stores/layoutStore";
import { useSidebarStore } from "@stores/sidebarStore";
import { useTabStore } from "@stores/tabStore";
import type React from "react";
import { useEffect, useState } from "react";

export const SidebarContent: React.FC = () => {
  const { client } = useAuthStore();
  const { tabs, createTab, setActiveTab, activeTabId } = useTabStore();
  const expandedNodesArray = useSidebarStore((state) => state.expandedNodes);
  const { toggleNode, expandAll, collapseAll } = useSidebarStore();
  const { setCliMode } = useLayoutStore();
  const { saveRecording } = useRecordings();
  const { startRecording, stopRecording } = useAudioRecorder(saveRecording);
  const [userName, setUserName] = useState<string>("Loading...");
  const [hoveredLineIndex, setHoveredLineIndex] = useState<number | null>(null);

  const expandedNodes = new Set(expandedNodesArray);
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
  const allNodeIds = getAllNodeIds([menuData], "", 0);
  const allExpanded =
    allNodeIds.length > 0 && allNodeIds.every((id) => expandedNodes.has(id));

  const handleToggleExpandAll = () => {
    if (allExpanded) {
      collapseAll();
    } else {
      expandAll(allNodeIds);
    }
  };

  return (
    <Box
      style={{
        flexGrow: 1,
        overflow: "auto",
      }}
    >
      <Box p="2">
        <div className="sidebar-tree">
          {treeLines.map((line, index) => {
            const isRoot = index === 0;
            if (isRoot) {
              return (
                <Flex key={line.nodeId} align="center" justify="between" mb="1">
                  <span style={{ fontWeight: 500 }}>{line.label}</span>
                  <Tooltip
                    content={allExpanded ? "Collapse all" : "Expand all"}
                  >
                    <IconButton
                      size="1"
                      variant="ghost"
                      color="gray"
                      onClick={handleToggleExpandAll}
                      style={{ cursor: "pointer" }}
                    >
                      {allExpanded ? (
                        <ArrowsInSimpleIcon size={12} />
                      ) : (
                        <ArrowsOutSimpleIcon size={12} />
                      )}
                    </IconButton>
                  </Tooltip>
                </Flex>
              );
            }
            return (
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
            );
          })}
        </div>
      </Box>
    </Box>
  );
};
