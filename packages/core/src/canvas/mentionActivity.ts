import { mentionsUser } from "@posthog/shared";
import type {
  Task,
  TaskThreadMessage,
  UserBasic,
} from "@posthog/shared/domain-types";

/**
 * Derives the Activity feed — thread messages that @-mention the current user
 * — from data every client already has: channel task lists and their thread
 * messages. Mentions live inline in message content (see `@posthog/shared`
 * mentions), so no dedicated notifications backend is involved.
 */

/** A channel task paired with the channel context the feed needs. */
export interface MentionActivityTaskRef {
  task: Task;
  /** Backend channel name, for the "#channel" label. */
  channelName: string;
  /** Desktop folder channel id (the /website route param); null when unmapped. */
  folderChannelId: string | null;
}

export interface MentionActivityItem {
  messageId: string;
  taskId: string;
  taskTitle: string;
  channelName: string;
  folderChannelId: string | null;
  author: UserBasic | null;
  content: string;
  createdAt: string;
}

/** Mentions of the current user across channel threads, newest first. */
export function buildMentionActivity(
  currentUserEmail: string | null | undefined,
  tasks: MentionActivityTaskRef[],
  threadsByTaskId: ReadonlyMap<string, TaskThreadMessage[]>,
): MentionActivityItem[] {
  if (!currentUserEmail) return [];
  const self = currentUserEmail.toLowerCase();
  const items: MentionActivityItem[] = [];
  for (const { task, channelName, folderChannelId } of tasks) {
    for (const message of threadsByTaskId.get(task.id) ?? []) {
      // Self-mentions aren't notifications.
      if (message.author?.email?.toLowerCase() === self) continue;
      if (!mentionsUser(message.content, self)) continue;
      items.push({
        messageId: message.id,
        taskId: task.id,
        taskTitle: task.title || "Untitled task",
        channelName,
        folderChannelId,
        author: message.author ?? null,
        content: message.content,
        createdAt: message.created_at,
      });
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** How many items arrived after the viewer last opened the Activity page. */
export function countUnseenActivity(
  items: readonly MentionActivityItem[],
  lastSeenAt: string | null,
): number {
  if (!lastSeenAt) return items.length;
  return items.filter((item) => item.createdAt > lastSeenAt).length;
}
