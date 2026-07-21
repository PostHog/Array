import type { Task } from "@posthog/shared/domain-types";

const RETENTION_MS = 5 * 60_000;
const retainedTasks = new Map<string, { task: Task; retainedAt: number }>();

function pruneExpired(now: number): void {
  for (const [taskId, retained] of retainedTasks) {
    if (now - retained.retainedAt >= RETENTION_MS) {
      retainedTasks.delete(taskId);
    }
  }
}

export function retainTask(task: Task): void {
  const now = Date.now();
  pruneExpired(now);
  retainedTasks.set(task.id, { task, retainedAt: now });
}

export function releaseRetainedTask(taskId: string): void {
  retainedTasks.delete(taskId);
}

export function mergeRetainedTasks(tasks: Task[]): Task[] {
  pruneExpired(Date.now());
  const serverTaskIds = new Set(tasks.map((task) => task.id));
  const missing: Task[] = [];

  for (const [taskId, retained] of retainedTasks) {
    if (serverTaskIds.has(taskId)) {
      retainedTasks.delete(taskId);
    } else {
      missing.push(retained.task);
    }
  }

  return missing.length > 0 ? [...missing, ...tasks] : tasks;
}
