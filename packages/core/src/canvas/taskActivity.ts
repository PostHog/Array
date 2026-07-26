import type {
  TaskActivity,
  TaskActivityKind,
  UserBasic,
} from "@posthog/shared/domain-types";

/**
 * The Activity feed — tasks the current user is involved in (created, mentioned
 * in, or messaged in) — as served by the backend task-activity index
 * (`getTaskActivity`). One row per task, newest activity first; the client only
 * maps DTOs to items.
 */

export interface TaskActivityItem {
  taskId: string;
  taskTitle: string;
  /** Backend channel (tasks product Channel UUID); null for channel-less tasks. */
  channelId: string | null;
  /** Backend channel name, for the "#channel" label. */
  channelName: string | null;
  activityAt: string;
  activityKind: TaskActivityKind;
  /** Content of the message tied to the latest activity; empty for created rows. */
  snippet: string;
  author: UserBasic | null;
  messageId: string | null;
}

/** Map activity DTOs (already newest-first from the backend) to feed items. */
export function toTaskActivityItems(
  activity: readonly TaskActivity[],
): TaskActivityItem[] {
  return activity.map((row) => ({
    taskId: row.task_id,
    taskTitle: row.task_title || "Untitled task",
    channelId: row.channel_id ?? null,
    channelName: row.channel_name ?? null,
    activityAt: row.activity_at,
    activityKind: row.activity_kind,
    snippet: row.snippet,
    author: row.latest_author ?? null,
    messageId: row.latest_message_id ?? null,
  }));
}

/** How many rows have activity after the viewer last opened the Activity page. */
export function countUnseenActivity(
  items: readonly TaskActivityItem[],
  lastSeenAt: string | null,
): number {
  if (!lastSeenAt) return items.length;
  return items.filter((item) => item.activityAt > lastSeenAt).length;
}

// Bounds the cache so a long-running session's accumulated feed can't grow
// without limit.
const MAX_CACHED_ACTIVITY = 300;

/**
 * Fold a page of freshly-fetched activity into the previously cached set —
 * dedupe by task (newest activity wins), keep newest first. Lets repolls fetch
 * only what's new (via `since`) instead of re-fetching the whole top page every
 * time. A task whose activity advanced comes back on the next poll and replaces
 * its stale row rather than duplicating it.
 */
export function mergeTaskActivity(
  previous: readonly TaskActivity[],
  incoming: readonly TaskActivity[],
): TaskActivity[] {
  if (incoming.length === 0) return [...previous];
  const byTaskId = new Map(previous.map((row) => [row.task_id, row]));
  for (const row of incoming) {
    const existing = byTaskId.get(row.task_id);
    if (!existing || row.activity_at > existing.activity_at) {
      byTaskId.set(row.task_id, row);
    }
  }
  return Array.from(byTaskId.values())
    .sort((a, b) => (a.activity_at < b.activity_at ? 1 : -1))
    .slice(0, MAX_CACHED_ACTIVITY);
}
