import type { TaskLabel } from "@posthog/shared";

export interface RawTaskTimestamp {
  pinnedAt: string | null;
  lastViewedAt: string | null;
  lastActivityAt: string | null;
  label: TaskLabel | null;
}

export interface TaskTimestamps {
  lastViewedAt: number | null;
  lastActivityAt: number | null;
  label: TaskLabel | null;
}

export function parseTimestamps(
  raw: Record<string, RawTaskTimestamp>,
): Record<string, TaskTimestamps> {
  const result: Record<string, TaskTimestamps> = {};
  for (const [taskId, ts] of Object.entries(raw)) {
    result[taskId] = {
      lastViewedAt: ts.lastViewedAt
        ? new Date(ts.lastViewedAt).getTime()
        : null,
      lastActivityAt: ts.lastActivityAt
        ? new Date(ts.lastActivityAt).getTime()
        : null,
      label: ts.label ?? null,
    };
  }
  return result;
}
