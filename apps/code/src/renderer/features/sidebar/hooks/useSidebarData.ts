import { useArchivedTaskIds } from "@features/archive/hooks/useArchivedTaskIds";
import { useProvisioningStore } from "@features/provisioning/stores/provisioningStore";
import { useSessions } from "@features/sessions/stores/sessionStore";
import { useSuspendedTaskIds } from "@features/suspension/hooks/useSuspendedTaskIds";
import { useTaskSummaries, useTasks } from "@features/tasks/hooks/useTasks";
import { useWorkspaces } from "@features/workspace/hooks/useWorkspace";
import type { Schemas } from "@renderer/api/generated";
import type { Task, TaskRunStatus } from "@shared/types";
import { useEffect, useMemo, useRef } from "react";
import { useSidebarStore } from "../stores/sidebarStore";
import type { SortMode } from "../types";
import {
  type TaskGroup as GenericTaskGroup,
  getRepositoryInfo,
  groupByRepository,
  type TaskRepositoryInfo,
} from "../utils/groupTasks";
import { computeSummaryIds } from "../utils/summaryIds";
import { usePinnedTasks } from "./usePinnedTasks";
import { useTaskViewed } from "./useTaskViewed";

export interface TaskData {
  id: string;
  title: string;
  createdAt: number;
  lastActivityAt: number;
  isGenerating: boolean;
  isUnread: boolean;
  isPinned: boolean;
  needsPermission: boolean;
  repository: TaskRepositoryInfo | null;
  isSuspended: boolean;
  folderId?: string;
  taskRunStatus?: TaskRunStatus;
  taskRunEnvironment?: "local" | "cloud";
  folderPath: string | null;
  cloudPrUrl: string | null;
  branchName: string | null;
  linkedBranch: string | null;
}

export type TaskGroup = GenericTaskGroup<TaskData>;

export interface SidebarData {
  isHomeActive: boolean;
  isInboxActive: boolean;
  isCommandCenterActive: boolean;
  isSkillsActive: boolean;
  isMcpServersActive: boolean;
  isSetupActive: boolean;
  isLoading: boolean;
  activeTaskId: string | null;
  pinnedTasks: TaskData[];
  flatTasks: TaskData[];
  groupedTasks: TaskGroup[];
  totalCount: number;
  hasMore: boolean;
}

interface ViewState {
  type:
    | "task-detail"
    | "task-input"
    | "settings"
    | "folder-settings"
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

function getSortValue(task: TaskData, sortMode: SortMode): number {
  return sortMode === "updated" ? task.lastActivityAt : task.createdAt;
}

function sortTasks(tasks: TaskData[], sortMode: SortMode): TaskData[] {
  return tasks.sort(
    (a, b) => getSortValue(b, sortMode) - getSortValue(a, sortMode),
  );
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
  // showAllUsers stays on the heavy /tasks/ list endpoint until that path gets
  // its own optimization (e.g. server-side recency pagination). The mapping
  // below narrows full Task → TaskSummary so downstream sidebar code stays uniform.
  const { data: fullTasks = [], isLoading: isTasksLoading } = useTasks(
    { showAllUsers, showInternal },
    { enabled: showAllUsers },
  );

  type SidebarTask = Schemas.TaskSummary & {
    latest_run:
      | (Schemas.TaskSummary["latest_run"] & {
          output?: { pr_url?: unknown } | null;
        })
      | null;
  };

  const rawTasks: SidebarTask[] = useMemo(() => {
    if (!showAllUsers) return summaryTasks;
    return fullTasks.map((t) => ({
      id: t.id,
      title: t.title,
      repository: t.repository ?? null,
      created_at: t.created_at,
      updated_at: t.updated_at,
      latest_run: t.latest_run
        ? {
            status: t.latest_run.status,
            environment: t.latest_run.environment ?? null,
            output: t.latest_run.output ?? null,
          }
        : null,
    }));
  }, [showAllUsers, summaryTasks, fullTasks]);

  const isPrimaryLoading = showAllUsers ? isTasksLoading : isSummariesLoading;
  const isLoading = isPrimaryLoading || !isWorkspacesFetched;

  const allTasks = useMemo(
    () =>
      rawTasks.filter(
        (task) =>
          !archivedTaskIds.has(task.id) &&
          (showAllUsers ||
            showInternal ||
            !!workspaces?.[task.id] ||
            provisioningTaskIds.has(task.id)),
      ),
    [
      rawTasks,
      archivedTaskIds,
      workspaces,
      showAllUsers,
      showInternal,
      provisioningTaskIds,
    ],
  );
  const organizeMode = useSidebarStore((state) => state.organizeMode);
  const sortMode = useSidebarStore((state) => state.sortMode);
  const folderOrder = useSidebarStore((state) => state.folderOrder);

  const isHomeActive = activeView.type === "task-input";
  const isInboxActive = activeView.type === "inbox";
  const isCommandCenterActive = activeView.type === "command-center";
  const isSkillsActive = activeView.type === "skills";
  const isMcpServersActive = activeView.type === "mcp-servers";
  const isSetupActive = activeView.type === "setup";

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

  const taskData = useMemo(() => {
    return allTasks.map((task) => {
      const session = sessionByTaskId.get(task.id);
      const workspace = workspaces?.[task.id];
      const apiUpdatedAt = new Date(task.updated_at).getTime();
      const taskTimestamps = timestamps[task.id];
      const localActivity = taskTimestamps?.lastActivityAt;
      const lastActivityAt = localActivity
        ? Math.max(apiUpdatedAt, localActivity)
        : apiUpdatedAt;
      const createdAt = new Date(task.created_at).getTime();

      const taskLastViewedAt = taskTimestamps?.lastViewedAt;
      const isUnread =
        taskLastViewedAt != null && lastActivityAt > taskLastViewedAt;

      const cloudPrUrl =
        typeof task.latest_run?.output?.pr_url === "string"
          ? task.latest_run.output.pr_url
          : ((session?.cloudOutput?.pr_url as string | undefined) ?? null);

      return {
        id: task.id,
        title: task.title,
        createdAt,
        lastActivityAt,
        isGenerating: session?.isPromptPending ?? false,
        isUnread,
        isPinned: pinnedTaskIds.has(task.id),
        isSuspended: suspendedTaskIds.has(task.id),
        needsPermission: (session?.pendingPermissions?.size ?? 0) > 0,
        repository: getRepositoryInfo(task, workspace?.folderPath),
        folderId: workspace?.folderId || undefined,
        taskRunStatus:
          session?.cloudStatus ?? task.latest_run?.status ?? undefined,
        taskRunEnvironment: task.latest_run?.environment ?? undefined,
        folderPath: workspace?.folderPath ?? null,
        cloudPrUrl,
        branchName: workspace?.branchName ?? null,
        linkedBranch: workspace?.linkedBranch ?? null,
      };
    });
  }, [
    allTasks,
    timestamps,
    pinnedTaskIds,
    suspendedTaskIds,
    sessionByTaskId,
    workspaces,
  ]);

  const pinnedTasks = useMemo(() => {
    const pinned = taskData.filter((task) => task.isPinned);
    return sortTasks(pinned, sortMode);
  }, [taskData, sortMode]);

  const unpinnedTasks = useMemo(
    () => taskData.filter((task) => !task.isPinned),
    [taskData],
  );

  const sortedUnpinnedTasks = useMemo(
    () => sortTasks([...unpinnedTasks], sortMode),
    [unpinnedTasks, sortMode],
  );

  const totalCount = unpinnedTasks.length;
  const hasMore =
    organizeMode === "chronological" &&
    sortedUnpinnedTasks.length > historyVisibleCount;

  const flatTasks = useMemo(() => {
    if (organizeMode !== "chronological") {
      return sortedUnpinnedTasks;
    }
    return sortedUnpinnedTasks.slice(0, historyVisibleCount);
  }, [organizeMode, sortedUnpinnedTasks, historyVisibleCount]);

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
    isInboxActive,
    isCommandCenterActive,
    isSkillsActive,
    isMcpServersActive,
    isSetupActive,
    isLoading,
    activeTaskId,
    pinnedTasks,
    flatTasks,
    groupedTasks,
    totalCount,
    hasMore,
  };
}
