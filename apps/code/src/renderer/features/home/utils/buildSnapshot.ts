import type { TaskData } from "@features/sidebar/hooks/useSidebarData";
import type { TaskRunStatus } from "@shared/types";
import type { PrSnapshot } from "@shared/types/pr-snapshot";
import type { SituationId } from "@shared/types/workflow";
import { classify } from "@shared/types/workflow-classify";

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

export type HomeWorkstreamTask = {
  id: string;
  title: string;
  status?: TaskRunStatus;
  isGenerating: boolean;
  needsPermission: boolean;
};

export type HomeWorkstream = {
  id: string;
  /** Bare repo name (e.g. "posthog") — for display only. */
  repoName: string | null;
  /**
   * Full "org/repo" slug, lowercased. The key the GitHub integration map and
   * cloud repo selectors use, so quick actions resolve from this, not `repoName`.
   */
  repoFullPath?: string | null;
  branch: string | null;
  prUrl: string | null;
  pr: PrSnapshot | null;
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

// Past this idle gap a still-`in_progress` run is treated as a status the server
// never closed out, not a live agent.
const RUNNING_STALE_THRESHOLD_MS = 30 * 60 * 1000;

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

// "Running" requires a live status AND genuine activity. An open PR means the
// agent moved past working into review; a long-idle run is a status the server
// never closed out — both fall through to grouping/classify(). An actively
// generating or waiting session is always live (its activity timestamp may not tick).
function isActivelyRunning(
  task: TaskData,
  now: number,
  hasPr: boolean,
): boolean {
  if (!isRunning(task.taskRunStatus)) return false;
  if (hasPr) return false;
  if (task.isGenerating || task.needsPermission) return true;
  return now - task.lastActivityAt <= RUNNING_STALE_THRESHOLD_MS;
}

// Grouping key precedence (docs/home-tab.md §5): resolved PR URL → repo+branch →
// worktree path. Tasks with none (e.g. an old cloud task, no PR, no checkout)
// are skipped, so Home stays a view of actual code work.
function workstreamKey(task: TaskData, prUrl: string | null): string | null {
  if (prUrl) return `pr:${prUrl}`;
  const repo = task.repository?.name ?? null;
  const branch = task.linkedBranch ?? task.branchName ?? null;
  if (repo && branch) return `branch:${repo}#${branch}`;
  if (task.folderPath) return `path:${task.folderPath}`;
  return null;
}

export function buildSnapshotFromTasks(
  pinned: TaskData[],
  flat: TaskData[],
  prByTaskId?: ReadonlyMap<string, PrSnapshot>,
): HomeSnapshot {
  const allTasks = [...pinned, ...flat];
  const now = Date.now();

  // Effective PR per task: resolved snapshot wins, else the cloud-run URL so
  // grouping works before the snapshot resolves.
  const prOf = (task: TaskData): PrSnapshot | null =>
    prByTaskId?.get(task.id) ?? null;
  const prUrlOf = (task: TaskData): string | null =>
    prOf(task)?.url ?? task.cloudPrUrl ?? null;

  const activeAgents: HomeActiveAgent[] = [];
  const groups = new Map<string, TaskData[]>();
  const taskInStrip = new Set<string>();

  for (const task of allTasks) {
    const prUrl = prUrlOf(task);
    if (isActivelyRunning(task, now, !!prUrl)) {
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
    const key = workstreamKey(task, prUrl);
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

    // First task that resolves to a PR carries the snapshot; PR-grouped tasks
    // share the URL anyway.
    let pr: PrSnapshot | null = null;
    let prUrl: string | null = null;
    for (const t of tasks) {
      const snap = prOf(t);
      const url = snap?.url ?? t.cloudPrUrl ?? null;
      if (url) {
        pr = snap;
        prUrl = url;
        break;
      }
    }
    const branch = head.linkedBranch ?? head.branchName ?? null;
    const lastActivityAt = head.lastActivityAt;

    const situations = Array.from(
      classify({
        hasPrUrl: !!prUrl,
        pr,
        branch,
        lastActivityAt,
        now,
      }),
    );

    const workstream: HomeWorkstream = {
      id,
      repoName: head.repository?.name ?? null,
      repoFullPath: head.repository?.fullPath ?? null,
      branch,
      prUrl,
      pr,
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
