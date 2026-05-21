/** Minimal shape needed to resolve the effective task id from session meta. */
interface TaskIdSource {
  taskId?: string;
  persistence?: { taskId?: string };
}

/**
 * The task id can arrive directly on the session meta or nested under
 * `persistence`; prefer the top-level value. Shared by the Claude and Codex
 * adapters so the fallback chain stays in sync.
 */
export function resolveTaskId(
  meta: TaskIdSource | undefined,
): string | undefined {
  return meta?.taskId ?? meta?.persistence?.taskId;
}
