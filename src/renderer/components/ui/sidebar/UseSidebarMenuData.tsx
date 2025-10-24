import {
  CheckCircleIcon,
  CircleIcon,
  FolderIcon,
  GearIcon,
  ListNumbersIcon,
  PlusIcon,
  SquareIcon,
  SquaresFourIcon,
  WaveformIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { TabState, Task } from "@shared/types";
import { useMemo } from "react";
import { useRecordingStore } from "../../../features/recordings/stores/recordingStore";
import { useTasks } from "../../../hooks/useTasks";
import type { TreeNode } from "./Types";

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface UseSidebarMenuDataProps {
  userName: string;
  activeTab: TabState | undefined;
  onNavigate: (
    type: "task-list" | "recordings" | "settings",
    title: string,
  ) => void;
  onTaskClick: (task: Task) => void;
  onCreateTask: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

function getStatusIcon(status?: string) {
  if (status === "in_progress" || status === "started") {
    return (
      <CircleIcon size={12} weight="fill" style={{ color: "var(--blue-9)" }} />
    );
  }
  if (status === "completed") {
    return (
      <CheckCircleIcon
        size={12}
        weight="fill"
        style={{ color: "var(--green-9)" }}
      />
    );
  }
  if (status === "failed") {
    return (
      <XCircleIcon size={12} weight="fill" style={{ color: "var(--red-9)" }} />
    );
  }
  return <CircleIcon size={12} style={{ color: "var(--gray-8)" }} />;
}

export function useSidebarMenuData({
  userName,
  activeTab,
  onNavigate,
  onTaskClick,
  onCreateTask,
  onStartRecording,
  onStopRecording,
}: UseSidebarMenuDataProps): TreeNode {
  const { data: allTasks = [] } = useTasks();
  const isRecording = useRecordingStore((state) => state.isRecording);
  const recordingDuration = useRecordingStore(
    (state) => state.recordingDuration,
  );

  const relevantTasks = useMemo(() => {
    return allTasks
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )
      .slice(0, 10);
  }, [allTasks]);

  return useMemo(
    () => ({
      label: userName,
      children: [
        {
          label: "My tasks",
          icon: (
            <ListNumbersIcon
              size={12}
              weight={activeTab?.type === "task-list" ? "fill" : "regular"}
            />
          ),
          action: () => onNavigate("task-list", "Tasks"),
          isActive: activeTab?.type === "task-list",
          hoverAction: onCreateTask,
          hoverIcon: <PlusIcon size={12} />,
        },
        {
          label: isRecording
            ? `Recordings ${formatDuration(recordingDuration)}`
            : "Recordings",
          icon: isRecording ? (
            <CircleIcon
              size={12}
              weight="fill"
              style={{ color: "var(--red-9)" }}
            />
          ) : (
            <WaveformIcon
              size={12}
              weight={activeTab?.type === "recordings" ? "fill" : "regular"}
            />
          ),
          action: () => onNavigate("recordings", "Recordings"),
          isActive: activeTab?.type === "recordings",
          hoverAction: isRecording ? onStopRecording : onStartRecording,
          hoverIcon: isRecording ? (
            <SquareIcon
              size={10}
              weight="fill"
              style={{ color: "var(--red-9)" }}
            />
          ) : (
            <CircleIcon
              size={10}
              weight="fill"
              style={{ color: "var(--red-9)" }}
            />
          ),
          showHoverIconAlways: isRecording,
        },
        {
          label: "Settings",
          icon: (
            <GearIcon
              size={12}
              weight={activeTab?.type === "settings" ? "fill" : "regular"}
            />
          ),
          forceSeparator: true,
          action: () => onNavigate("settings", "Settings"),
          isActive: activeTab?.type === "settings",
        },
        ...(relevantTasks.length > 0
          ? [
              {
                label: "Tasks",
                icon: <ListNumbersIcon size={12} />,
                children: relevantTasks.map((task): TreeNode => {
                  const status = task.latest_run?.status || "pending";
                  const statusLabel = status.replace("_", " ");
                  const isActiveTask = !!(
                    activeTab?.type === "task-detail" &&
                    activeTab.data &&
                    typeof activeTab.data === "object" &&
                    "id" in activeTab.data &&
                    activeTab.data.id === task.id
                  );
                  return {
                    label: task.title,
                    icon: getStatusIcon(status),
                    action: () => onTaskClick(task),
                    isActive: isActiveTask,
                    tooltip: `${task.slug} | ${task.title} (${statusLabel})`,
                  };
                }),
                forceSeparator: true,
              },
            ]
          : []),
        {
          label: "Views",
          icon: <SquaresFourIcon size={12} />,
          children: [{ label: "Work in progress" }],
        },
        {
          label: "Projects",
          icon: <FolderIcon size={12} />,
          children: [
            { label: "Array" },
            { label: "posthog" },
            { label: "agent" },
          ],
        },
      ],
    }),
    [
      userName,
      activeTab,
      relevantTasks,
      onNavigate,
      onTaskClick,
      onCreateTask,
      onStartRecording,
      onStopRecording,
      isRecording,
      recordingDuration,
    ],
  );
}
