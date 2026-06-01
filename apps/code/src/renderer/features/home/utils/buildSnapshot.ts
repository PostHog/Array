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

// The PR/CI snapshot a workstream is classified against. Populated from the
// gh-backed PrSnapshotService (null until its first fetch resolves) and by demo
// fixtures; the production PostHog feed produces the same shape — see
// docs/workflow-architecture.md.
export type HomePullRequest = PrSnapshot;

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

// Grouping key precedence (per docs/home-tab.md §5):
// PR URL → repo+branch → worktree path. `prUrl` here is the *resolved* URL
// (cloud run output or a branch lookup), so a PR that only exists on the branch
// still groups a task under its PR. Tasks with none of these — e.g. an old
// cloud task with no PR and no local checkout — return null and are skipped, so
// Home stays a view of actual code work rather than every historical task.
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

  // Effective PR per task: a resolved snapshot (cloud run *or* branch lookup)
  // wins; fall back to the cloud-run URL so grouping still works before the
  // snapshot resolves.
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

    // First task in the group that resolves to a PR carries the snapshot;
    // grouped-by-PR tasks all share the same URL anyway.
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
