import {
  type SidebarData,
  type TaskData,
  useSidebarData,
} from "@features/sidebar/hooks/useSidebarData";
import type { TaskRunStatus } from "@shared/types";
import type { SituationId } from "@shared/types/workflow";
import { classify } from "@shared/types/workflow-classify";
import { useNavigationStore } from "@stores/navigationStore";
import { useMemo } from "react";
import { buildDemoSnapshot, EMPTY_SNAPSHOT } from "../fixtures/demoSnapshot";
import { useHomeDemoStore } from "../stores/homeDemoStore";

export type HomeActiveAgent = {
  taskId: string;
  title: string;
  repoName: string | null;
  branch: string | null;
  status: TaskRunStatus;
  lastActivityAt: number;
  needsPermission: boolean;
  cloudPrUrl: string | null;
};

// Until the GitHub fetcher lands, real data only ever has `pr: null`. Kept
// on the type because demo fixtures populate it and the detail panel renders
// the richer view when present.
export type HomePullRequest = {
  url: string;
  number: number;
  title: string;
  state: "open" | "draft" | "merged" | "closed";
  ciStatus: "passing" | "failing" | "pending" | "none";
  unresolvedThreads: number;
  reviewDecision: "approved" | "changes_requested" | "review_required" | null;
  isCurrentUserRequestedReviewer: boolean;
  isCurrentUserAuthor: boolean;
  author: string | null;
  lastUpdatedAt: number;
};

export type HomeWorkstreamTask = {
  id: string;
  title: string;
  status?: TaskRunStatus;
  isGenerating: boolean;
  needsPermission: boolean;
};

export type HomeWorkstream = {
  id: string;
  repoName: string | null;
  branch: string | null;
  prUrl: string | null;
  pr: HomePullRequest | null;
  tasks: HomeWorkstreamTask[];
  /** Situations this workstream is in — drives board placement + bound actions. */
  situations: SituationId[];
  lastActivityAt: number;
};

export type HomeSnapshot = {
  activeAgents: HomeActiveAgent[];
  needsAttention: HomeWorkstream[];
  inProgress: HomeWorkstream[];
};

const RUNNING_STATUSES: ReadonlySet<TaskRunStatus> = new Set([
  "queued",
  "in_progress",
]);

// Situations that escalate a workstream into the "Needs attention" bucket on
// the list view. Everything else falls into "In progress".
const ATTENTION_SITUATIONS: ReadonlySet<SituationId> = new Set([
  "ci_failing",
  "changes_requested",
  "comments_waiting",
  "stale",
]);

function isRunning(status?: TaskRunStatus): boolean {
  return !!status && RUNNING_STATUSES.has(status);
}

function workstreamKey(task: TaskData): string | null {
  const repo = task.repository?.name ?? null;
  const branch = task.linkedBranch ?? task.branchName ?? null;
  if (task.cloudPrUrl) return `pr:${task.cloudPrUrl}`;
  if (repo && branch) return `branch:${repo}#${branch}`;
  return null;
}

function buildSnapshotFromTasks(
  pinned: TaskData[],
  flat: TaskData[],
): HomeSnapshot {
  const allTasks = [...pinned, ...flat];
  const now = Date.now();

  const activeAgents: HomeActiveAgent[] = [];
  const groups = new Map<string, TaskData[]>();
  const taskInStrip = new Set<string>();

  for (const task of allTasks) {
    if (isRunning(task.taskRunStatus)) {
      activeAgents.push({
        taskId: task.id,
        title: task.title,
        repoName: task.repository?.name ?? null,
        branch: task.linkedBranch ?? task.branchName ?? null,
        status: task.taskRunStatus as TaskRunStatus,
        lastActivityAt: task.lastActivityAt,
        needsPermission: task.needsPermission,
        cloudPrUrl: task.cloudPrUrl,
      });
      taskInStrip.add(task.id);
      continue;
    }
    const key = workstreamKey(task);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(task);
    else groups.set(key, [task]);
  }

  activeAgents.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  const needsAttention: HomeWorkstream[] = [];
  const inProgress: HomeWorkstream[] = [];

  for (const [id, tasks] of groups) {
    tasks.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    const head = tasks[0];
    if (!head) continue;

    if (tasks.every((t) => taskInStrip.has(t.id))) continue;

    const prUrl = tasks.find((t) => t.cloudPrUrl)?.cloudPrUrl ?? null;
    const branch = head.linkedBranch ?? head.branchName ?? null;
    const lastActivityAt = head.lastActivityAt;

    const situations = Array.from(
      classify({
        hasPrUrl: !!prUrl,
        pr: null,
        branch,
        lastActivityAt,
        now,
      }),
    );

    const workstream: HomeWorkstream = {
      id,
      repoName: head.repository?.name ?? null,
      branch,
      prUrl,
      pr: null,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.taskRunStatus,
        isGenerating: t.isGenerating,
        needsPermission: t.needsPermission,
      })),
      situations,
      lastActivityAt,
    };

    if (situations.some((s) => ATTENTION_SITUATIONS.has(s))) {
      needsAttention.push(workstream);
    } else {
      inProgress.push(workstream);
    }
  }

  needsAttention.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  inProgress.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  return { activeAgents, needsAttention, inProgress };
}

export function useHomeSnapshot(): {
  snapshot: HomeSnapshot;
  isLoading: boolean;
  sidebarData: SidebarData;
  isDemo: boolean;
} {
  const view = useNavigationStore((s) => s.view);
  const sidebarData = useSidebarData({ activeView: view });
  const demoScenario = useHomeDemoStore((s) => s.scenario);

  const realSnapshot = useMemo(
    () =>
      buildSnapshotFromTasks(sidebarData.pinnedTasks, sidebarData.flatTasks),
    [sidebarData.pinnedTasks, sidebarData.flatTasks],
  );

  const snapshot = useMemo(() => {
    if (demoScenario === "populated") return buildDemoSnapshot();
    if (demoScenario === "empty") return EMPTY_SNAPSHOT;
    return realSnapshot;
  }, [demoScenario, realSnapshot]);

  return {
    snapshot,
    isLoading: demoScenario !== "off" ? false : sidebarData.isLoading,
    sidebarData,
    isDemo: demoScenario !== "off",
  };
}
