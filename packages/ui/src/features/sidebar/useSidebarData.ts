import {
  deriveTaskData,
  type FullTask,
  filterVisibleTasks,
  narrowFullTask,
  partitionAndSortTasks,
  type SidebarTask,
  sliceChronological,
} from "@posthog/core/sidebar/buildSidebarData";
import { groupByRepository } from "@posthog/core/sidebar/groupTasks";
import type {
  SidebarData,
  TaskData,
  TaskGroup,
} from "@posthog/core/sidebar/sidebarData.types";
import { computeSummaryIds } from "@posthog/core/sidebar/summaryIds";
import type { Task } from "@posthog/shared/domain-types";
import { useEffect, useMemo, useRef } from "react";
import { useArchivedTaskIds } from "../archive/useArchivedTaskIds";
import { useProvisioningStore } from "../provisioning/store";
import { useSessions } from "../sessions/sessionStore";
import { useSuspendedTaskIds } from "../suspension/useSuspendedTaskIds";
import { useSlackTasks, useTaskSummaries, useTasks } from "../tasks/useTasks";
import { useWorkspaces } from "../workspace/useWorkspace";
import { useSidebarStore } from "./sidebarStore";
import { usePinnedTasks } from "./usePinnedTasks";
import { useTaskViewed } from "./useTaskViewed";

export type { SidebarData, TaskData, TaskGroup };

interface ViewState {
  type:
    | "task-detail"
    | "task-pending"
    | "task-input"
    | "settings"
    | "folder-settings"
    | "home"
    | "inbox"
    | "archived"
    | "command-center"
    | "skills"
    | "mcp-servers"
    | "setup";
  data?: Task;
}

interface UseSidebarDataProps {
  activeView: ViewState;
}

export function useSidebarData({
  activeView,
}: UseSidebarDataProps): SidebarData {
  const showAllUsers = useSidebarStore((state) => state.showAllUsers);
  const showInternal = useSidebarStore((state) => state.showInternal);
  const { data: workspaces, isFetched: isWorkspacesFetched } = useWorkspaces();
  const archivedTaskIds = useArchivedTaskIds();
  const suspendedTaskIds = useSuspendedTaskIds();
  const provisioningTaskIds = useProvisioningStore((s) => s.activeTasks);
  const sessions = useSessions();
  const { timestamps } = useTaskViewed();
  const historyVisibleCount = useSidebarStore(
    (state) => state.historyVisibleCount,
  );
  const { pinnedTaskIds } = usePinnedTasks();
  const organizeMode = useSidebarStore((state) => state.organizeMode);
  const sortMode = useSidebarStore((state) => state.sortMode);
  const folderOrder = useSidebarStore((state) => state.folderOrder);

  const summaryIds = useMemo(
    () =>
      showAllUsers
        ? []
        : computeSummaryIds({
            workspaceIds: workspaces ? Object.keys(workspaces) : [],
            pinnedTaskIds,
            provisioningTaskIds,
            archivedTaskIds,
          }),
    [
      showAllUsers,
      workspaces,
      pinnedTaskIds,
      provisioningTaskIds,
      archivedTaskIds,
    ],
  );

  const { data: summaryTasks = [], isLoading: isSummariesLoading } =
    useTaskSummaries(summaryIds, { enabled: !showAllUsers });
  const { data: fullTasks = [], isLoading: isTasksLoading } = useTasks(
    { showAllUsers, showInternal },
    { enabled: showAllUsers },
  );
  const { data: slackTasks = [] } = useSlackTasks({
    enabled: !showAllUsers,
    showInternal,
  });
  const slackTaskIds = useMemo(
    () => new Set(slackTasks.map((t) => t.id)),
    [slackTasks],
  );
  const slackThreadUrlByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of slackTasks) {
      const url = t.latest_run?.state?.slack_thread_url;
      if (typeof url === "string") map.set(t.id, url);
    }
    return map;
  }, [slackTasks]);

  const rawTasks = useMemo<SidebarTask[]>(
    () =>
      showAllUsers
        ? fullTasks.map((t) => narrowFullTask(t as FullTask))
        : (summaryTasks as SidebarTask[]),
    [showAllUsers, summaryTasks, fullTasks],
  );

  const isPrimaryLoading = showAllUsers ? isTasksLoading : isSummariesLoading;
  const isLoading = isPrimaryLoading || !isWorkspacesFetched;

  const workspaceIds = useMemo(
    () => new Set(workspaces ? Object.keys(workspaces) : []),
    [workspaces],
  );

  const allTasks = useMemo(
    () =>
      filterVisibleTasks(rawTasks, {
        archivedIds: archivedTaskIds,
        workspaceIds,
        provisioningIds: provisioningTaskIds,
        showAllUsers,
        showInternal,
      }),
    [
      rawTasks,
      archivedTaskIds,
      workspaceIds,
      showAllUsers,
      showInternal,
      provisioningTaskIds,
    ],
  );

  const isHomeActive =
    activeView.type === "task-input" || activeView.type === "task-pending";
  const isHomeViewActive = activeView.type === "home";
  const isInboxActive = activeView.type === "inbox";
  const isCommandCenterActive = activeView.type === "command-center";
  const isSkillsActive = activeView.type === "skills";
  const isMcpServersActive = activeView.type === "mcp-servers";

  const activeTaskId =
    activeView.type === "task-detail" && activeView.data
      ? activeView.data.id
      : null;

  const sessionByTaskId = useMemo(() => {
    const map = new Map<string, (typeof sessions)[string]>();
    for (const session of Object.values(sessions)) {
      if (session.taskId) {
        map.set(session.taskId, session);
      }
    }
    return map;
  }, [sessions]);

  const taskData = useMemo(
    () =>
      allTasks.map((task) =>
        deriveTaskData(task, {
          session: sessionByTaskId.get(task.id),
          workspace: workspaces?.[task.id],
          timestamp: timestamps[task.id],
          pinnedIds: pinnedTaskIds,
          suspendedIds: suspendedTaskIds,
          slackTaskIds,
          slackThreadUrlByTaskId,
        }),
      ),
    [
      allTasks,
      timestamps,
      pinnedTaskIds,
      suspendedTaskIds,
      sessionByTaskId,
      workspaces,
      slackTaskIds,
      slackThreadUrlByTaskId,
    ],
  );

  const { pinnedTasks, sortedUnpinnedTasks, totalCount } = useMemo(
    () => partitionAndSortTasks(taskData, sortMode),
    [taskData, sortMode],
  );

  const { flatTasks, hasMore } = useMemo(
    () =>
      sliceChronological(
        sortedUnpinnedTasks,
        organizeMode,
        historyVisibleCount,
      ),
    [sortedUnpinnedTasks, organizeMode, historyVisibleCount],
  );

  const groupedTasks = useMemo(
    () => groupByRepository(sortedUnpinnedTasks, folderOrder),
    [sortedUnpinnedTasks, folderOrder],
  );

  const groupIdsRef = useRef<string[]>([]);
  useEffect(() => {
    if (groupedTasks.length === 0) return;
    const groupIds = groupedTasks.map((g) => g.id);
    const prev = groupIdsRef.current;
    if (
      groupIds.length === prev.length &&
      groupIds.every((id, i) => id === prev[i])
    ) {
      return;
    }
    groupIdsRef.current = groupIds;
    useSidebarStore.getState().syncFolderOrder(groupIds);
  }, [groupedTasks]);

  return {
    isHomeActive,
    isHomeViewActive,
    isInboxActive,
    isCommandCenterActive,
    isSkillsActive,
    isMcpServersActive,
    isLoading,
    activeTaskId,
    pinnedTasks,
    flatTasks,
    groupedTasks,
    totalCount,
    hasMore,
  };
}
