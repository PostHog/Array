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
import type { AppView } from "@posthog/ui/router/useAppView";
import { useEffect, useMemo, useRef } from "react";
import { useArchivedTaskIds } from "../archive/useArchivedTaskIds";
import { useProvisioningStore } from "../provisioning/store";
import { useSuspendedTaskIds } from "../suspension/useSuspendedTaskIds";
import { useWorkspaces } from "../workspace/useWorkspace";
import { useSidebarStore } from "./sidebarStore";
import { usePinnedTasks } from "./usePinnedTasks";
import { useSidebarSessionMap } from "./useSidebarSessionMap";
import { useSidebarTasks } from "./useSidebarTasks";
import { useTaskViewed } from "./useTaskViewed";

export type { SidebarData, TaskData, TaskGroup };

// Slack thread metadata rides on each task's own `origin_product`/state (see
// `narrowFullTask`), so the sidebar doesn't need a supplementary slack-task
// lookup. Stable empty references keep `deriveTaskData` memoized.
const EMPTY_TASK_IDS: ReadonlySet<string> = new Set();
const EMPTY_THREAD_URLS: ReadonlyMap<string, string> = new Map();

interface UseSidebarDataProps {
  activeView: AppView;
}

export function useSidebarData({
  activeView,
}: UseSidebarDataProps): SidebarData {
  const showAllUsers = useSidebarStore((state) => state.showAllUsers);
  const { data: workspaces, isFetched: isWorkspacesFetched } = useWorkspaces();
  const { tasks: fullTasks, isLoading: isTasksLoading } = useSidebarTasks();
  const archivedTaskIds = useArchivedTaskIds();
  const suspendedTaskIds = useSuspendedTaskIds();
  const provisioningTaskIds = useProvisioningStore((s) => s.activeTasks);
  const sessionByTaskId = useSidebarSessionMap();
  const { timestamps } = useTaskViewed();
  const historyVisibleCount = useSidebarStore(
    (state) => state.historyVisibleCount,
  );
  const { pinnedTaskIds } = usePinnedTasks();
  const organizeMode = useSidebarStore((state) => state.organizeMode);
  const sortMode = useSidebarStore((state) => state.sortMode);
  const folderOrder = useSidebarStore((state) => state.folderOrder);

  const rawTasks = useMemo<SidebarTask[]>(
    () => fullTasks.map((t) => narrowFullTask(t as FullTask)),
    [fullTasks],
  );

  const isLoading = isTasksLoading || !isWorkspacesFetched;

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
      }),
    [
      rawTasks,
      archivedTaskIds,
      workspaceIds,
      showAllUsers,
      provisioningTaskIds,
    ],
  );

  const isHomeActive =
    activeView.type === "task-input" || activeView.type === "task-pending";
  const isHomeViewActive = activeView.type === "home";
  const isInboxActive = activeView.type === "inbox";
  const isAgentsActive = activeView.type === "agents";
  const isCommandCenterActive = activeView.type === "command-center";
  const isSkillsActive = activeView.type === "skills";
  const isMcpServersActive = activeView.type === "mcp-servers";

  const activeTaskId =
    activeView.type === "task-detail" ? (activeView.taskId ?? null) : null;

  const taskData = useMemo(
    () =>
      allTasks.map((task) =>
        deriveTaskData(task, {
          session: sessionByTaskId.get(task.id),
          workspace: workspaces?.[task.id],
          timestamp: timestamps[task.id],
          pinnedIds: pinnedTaskIds,
          suspendedIds: suspendedTaskIds,
          slackTaskIds: EMPTY_TASK_IDS,
          slackThreadUrlByTaskId: EMPTY_THREAD_URLS,
        }),
      ),
    [
      allTasks,
      timestamps,
      pinnedTaskIds,
      suspendedTaskIds,
      sessionByTaskId,
      workspaces,
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
    isAgentsActive,
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
