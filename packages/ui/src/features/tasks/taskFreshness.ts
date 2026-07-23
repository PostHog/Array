import type { Task } from "@posthog/shared/domain-types";

function parseTime(value: string | null | undefined): number {
  const timestamp = value ? Date.parse(value) : Number.NEGATIVE_INFINITY;
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function getTaskFreshness(task: Task): number {
  return Math.max(
    parseTime(task.updated_at),
    parseTime(task.latest_run?.updated_at),
  );
}

export function pickFreshestTask(
  ...tasks: Array<Task | null | undefined>
): Task | undefined {
  let selected: Task | undefined;
  let selectedFreshness = Number.NEGATIVE_INFINITY;

  for (const task of tasks) {
    if (!task) continue;

    const freshness = getTaskFreshness(task);
    if (!selected || freshness > selectedFreshness) {
      selected = task;
      selectedFreshness = freshness;
    }
  }

  return selected;
}
