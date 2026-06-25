import type { Task, TaskRunStatus } from "@posthog/shared/domain-types";
import { getRepositoryInfo } from "./groupTasks";
import type { TaskData } from "./sidebarData.types";

export type SortMode = "updated" | "created";
export type OrganizeMode = "by-project" | "chronological";

export interface FullTask {
  id: string;
  title: string;
  repository?: string | null;
  created_at: string;
  updated_at: string;
  origin_product?: string;
  latest_run?: {
    status?: TaskRunStatus | null;
    environment?: "local" | "cloud" | null;
    output?: { pr_url?: unknown } | null;
    state?: Record<string, unknown> | null;
  } | null;
}

export interface SidebarTask {
  id: string;
  title: string;
  repository?: string | null;
  created_at: string;
  updated_at: string;
  origin_product?: string;
  slack_thread_url?: string;
  latest_run?: {
    status?: TaskRunStatus | null;
    environment?: "local" | "cloud" | null;
    output?: { pr_url?: unknown } | null;
  } | null;
}

// Accepts both the local `FullTask` shape and the canonical `Task` from
// `@posthog/shared` so callers holding a real `Task` can narrow it directly,
// without an `as unknown as FullTask` escape hatch.
export function narrowFullTask(task: FullTask | Task): SidebarTask {
  const slackThreadUrl = task.latest_run?.state?.slack_thread_url;
  return {
    id: task.id,
    title: task.title,
    repository: task.repository ?? null,
    created_at: task.created_at,
    updated_at: task.updated_at,
    latest_run: task.latest_run
      ? {
          status: task.latest_run.status,
          environment: task.latest_run.environment ?? null,
          output: task.latest_run.output ?? null,
        }
      : null,
    origin_product: task.origin_product,
    slack_thread_url:
      typeof slackThreadUrl === "string" ? slackThreadUrl : undefined,
  };
}

export interface FilterVisibleOptions {
  archivedIds: ReadonlySet<string>;
  workspaceIds: ReadonlySet<string>;
  provisioningIds: ReadonlySet<string>;
  showAllUsers: boolean;
  showInternal: boolean;
}

export function filterVisibleTasks(
  rawTasks: SidebarTask[],
  options: FilterVisibleOptions,
): SidebarTask[] {
  return rawTasks.filter(
    (task) =>
      !options.archivedIds.has(task.id) &&
      (options.showAllUsers ||
        options.showInternal ||
        options.workspaceIds.has(task.id) ||
        options.provisioningIds.has(task.id)),
  );
}

export interface TaskSession {
  isPromptPending?: boolean;
  pendingPermissions?: { size: number };
  cloudStatus?: TaskRunStatus;
  cloudOutput?: { pr_url?: unknown } | null;
}

export interface TaskWorkspace {
  folderId?: string | null;
  folderPath?: string | null;
  branchName?: string | null;
  linkedBranch?: string | null;
}

export interface TaskTimestamp {
  lastViewedAt?: number | null;
  lastActivityAt?: number | null;
}

export interface DeriveTaskDataContext {
  session: TaskSession | undefined;
  workspace: TaskWorkspace | undefined;
  timestamp: TaskTimestamp | undefined;
  pinnedIds: ReadonlySet<string>;
  suspendedIds: ReadonlySet<string>;
  slackTaskIds: ReadonlySet<string>;
  slackThreadUrlByTaskId: ReadonlyMap<string, string>;
}

export function deriveTaskData(
  task: SidebarTask,
  ctx: DeriveTaskDataContext,
): TaskData {
  const { session, workspace, timestamp } = ctx;
  const apiUpdatedAt = new Date(task.updated_at).getTime();
  const localActivity = timestamp?.lastActivityAt;
  const lastActivityAt = localActivity
    ? Math.max(apiUpdatedAt, localActivity)
    : apiUpdatedAt;
  const createdAt = new Date(task.created_at).getTime();

  const taskLastViewedAt = timestamp?.lastViewedAt;
  const isUnread =
    taskLastViewedAt != null && lastActivityAt > taskLastViewedAt;

  const cloudPrUrl =
    typeof task.latest_run?.output?.pr_url === "string"
      ? task.latest_run.output.pr_url
      : ((session?.cloudOutput?.pr_url as string | undefined) ?? null);

  const originProduct =
    task.origin_product ??
    (ctx.slackTaskIds.has(task.id) ? "slack" : undefined);
  const slackThreadUrl =
    task.slack_thread_url ?? ctx.slackThreadUrlByTaskId.get(task.id);

  return {
    id: task.id,
    title: task.title,
    createdAt,
    lastActivityAt,
    isGenerating: session?.isPromptPending ?? false,
    isUnread,
    isPinned: ctx.pinnedIds.has(task.id),
    isSuspended: ctx.suspendedIds.has(task.id),
    needsPermission: (session?.pendingPermissions?.size ?? 0) > 0,
    repository: getRepositoryInfo(task, workspace?.folderPath ?? undefined),
    folderId: workspace?.folderId || undefined,
    taskRunStatus: session?.cloudStatus ?? task.latest_run?.status ?? undefined,
    taskRunEnvironment: task.latest_run?.environment ?? undefined,
    originProduct,
    slackThreadUrl,
    folderPath: workspace?.folderPath ?? null,
    cloudPrUrl,
    branchName: workspace?.branchName ?? null,
    linkedBranch: workspace?.linkedBranch ?? null,
  };
}

function getSortValue(task: TaskData, sortMode: SortMode): number {
  return sortMode === "updated" ? task.lastActivityAt : task.createdAt;
}

function sortTasks(tasks: TaskData[], sortMode: SortMode): TaskData[] {
  return [...tasks].sort(
    (a, b) => getSortValue(b, sortMode) - getSortValue(a, sortMode),
  );
}

export interface PartitionedTasks {
  pinnedTasks: TaskData[];
  sortedUnpinnedTasks: TaskData[];
  totalCount: number;
}

export function partitionAndSortTasks(
  taskData: TaskData[],
  sortMode: SortMode,
): PartitionedTasks {
  const pinned: TaskData[] = [];
  const unpinned: TaskData[] = [];
  for (const task of taskData) {
    if (task.isPinned) {
      pinned.push(task);
    } else {
      unpinned.push(task);
    }
  }
  return {
    pinnedTasks: sortTasks(pinned, sortMode),
    sortedUnpinnedTasks: sortTasks(unpinned, sortMode),
    totalCount: unpinned.length,
  };
}

export interface ChronologicalSlice {
  flatTasks: TaskData[];
  hasMore: boolean;
}

export function sliceChronological(
  sortedUnpinnedTasks: TaskData[],
  organizeMode: OrganizeMode,
  historyVisibleCount: number,
): ChronologicalSlice {
  if (organizeMode !== "chronological") {
    return { flatTasks: sortedUnpinnedTasks, hasMore: false };
  }
  return {
    flatTasks: sortedUnpinnedTasks.slice(0, historyVisibleCount),
    hasMore: sortedUnpinnedTasks.length > historyVisibleCount,
  };
}
