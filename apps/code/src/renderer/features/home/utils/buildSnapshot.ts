import type { TaskData } from "@features/sidebar/hooks/useSidebarData";
import type { TaskRunStatus } from "@shared/types";
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

// How long a still-`in_progress` task can go without activity before we stop
// treating it as actually running. A live run idles for seconds, not half an
// hour — past this it's a status the server never transitioned to a terminal
// state, not a live agent.
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

// A task only belongs in the "Running" strip if its run status is live *and*
// it still looks genuinely active. A queued/in_progress status isn't enough on
// its own:
//   - Once a PR has been opened the agent has moved past working into review,
//     even if the cloud run status is still stuck at in_progress.
//   - A run with no activity for a while is a stale status the server never
//     transitioned to a terminal state.
// Both cases fall through to workstream grouping, where classify() routes them
// to "In review" / "Working" / "Stale". A session that's actively generating
// or waiting on the user is always live, so it's exempt from the stale check
// (its activity timestamp may not tick while it waits).
function isActivelyRunning(task: TaskData, now: number): boolean {
  if (!isRunning(task.taskRunStatus)) return false;
  if (task.cloudPrUrl) return false;
  if (task.isGenerating || task.needsPermission) return true;
  return now - task.lastActivityAt <= RUNNING_STALE_THRESHOLD_MS;
}

function workstreamKey(task: TaskData): string | null {
  const repo = task.repository?.name ?? null;
  const branch = task.linkedBranch ?? task.branchName ?? null;
  if (task.cloudPrUrl) return `pr:${task.cloudPrUrl}`;
  if (repo && branch) return `branch:${repo}#${branch}`;
  return null;
}

export function buildSnapshotFromTasks(
  pinned: TaskData[],
  flat: TaskData[],
): HomeSnapshot {
  const allTasks = [...pinned, ...flat];
  const now = Date.now();

  const activeAgents: HomeActiveAgent[] = [];
  const groups = new Map<string, TaskData[]>();
  const taskInStrip = new Set<string>();

  for (const task of allTasks) {
    if (isActivelyRunning(task, now)) {
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
