import {
  buildMentionActivity,
  type MentionActivityItem,
  type MentionActivityTaskRef,
} from "@posthog/core/canvas/mentionActivity";
import type { Task, TaskThreadMessage } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import {
  AUTH_SCOPED_QUERY_META,
  useCurrentUser,
} from "@posthog/ui/features/auth/useCurrentUser";
import { channelFeedQueryKey } from "@posthog/ui/features/canvas/hooks/useChannelFeed";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  normalizeChannelName,
  PERSONAL_CHANNEL_NAME,
  useTaskChannels,
} from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { taskThreadQueryKey } from "@posthog/ui/features/canvas/hooks/useTaskThread";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

// Mentions ride on channel/thread data the backend has no aggregate view of,
// so the feed is assembled client-side: tasks per channel, then each recent
// task's thread. Query keys are shared with the channel feed and thread panel,
// so an open channel keeps this fresh for free. Capping the thread fan-out to
// the most recent tasks bounds request volume; a backend mentions index is the
// eventual replacement if channels outgrow this.
const ACTIVITY_POLL_INTERVAL_MS = 60_000;
const MAX_SCANNED_TASKS = 50;

/**
 * Thread messages across all channels that @-mention the current user,
 * newest first. Mount once per surface (sidebar badge, Activity page) —
 * results are shared through the react-query cache.
 */
export function useMentionActivity(options?: { enabled?: boolean }): {
  items: MentionActivityItem[];
  isLoading: boolean;
} {
  const enabled = options?.enabled ?? true;
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });
  const { channels: taskChannels, isLoading: isLoadingChannels } =
    useTaskChannels();
  const { channels: folderChannels } = useChannels({ enabled });

  const taskQueries = useQueries({
    queries: taskChannels.map((channel) => ({
      queryKey: channelFeedQueryKey(channel.id),
      queryFn: async (): Promise<Task[]> => {
        if (!client) throw new Error("Not authenticated");
        return (await client.getTasks({
          channel: channel.id,
        })) as unknown as Task[];
      },
      enabled: enabled && !!client,
      refetchInterval: ACTIVITY_POLL_INTERVAL_MS,
      meta: AUTH_SCOPED_QUERY_META,
    })),
  });

  const taskRefs = useMemo(() => {
    const folderIdByName = new Map(
      folderChannels.map((folder) => [
        normalizeChannelName(folder.name),
        folder.id,
      ]),
    );
    const refs: MentionActivityTaskRef[] = [];
    taskChannels.forEach((channel, index) => {
      const folderChannelId =
        folderIdByName.get(
          channel.channel_type === "personal"
            ? PERSONAL_CHANNEL_NAME
            : channel.name,
        ) ?? null;
      for (const task of taskQueries[index]?.data ?? []) {
        refs.push({ task, channelName: channel.name, folderChannelId });
      }
    });
    return refs
      .sort((a, b) => b.task.created_at.localeCompare(a.task.created_at))
      .slice(0, MAX_SCANNED_TASKS);
  }, [taskChannels, folderChannels, taskQueries]);

  const threadQueries = useQueries({
    queries: taskRefs.map((ref) => ({
      queryKey: taskThreadQueryKey(ref.task.id),
      queryFn: async (): Promise<TaskThreadMessage[]> => {
        if (!client) throw new Error("Not authenticated");
        return client.getTaskThreadMessages(ref.task.id);
      },
      enabled: enabled && !!client,
      refetchInterval: ACTIVITY_POLL_INTERVAL_MS,
      meta: AUTH_SCOPED_QUERY_META,
    })),
  });

  const items = useMemo(() => {
    const threadsByTaskId = new Map<string, TaskThreadMessage[]>();
    taskRefs.forEach((ref, index) => {
      const messages = threadQueries[index]?.data;
      if (messages) threadsByTaskId.set(ref.task.id, messages);
    });
    return buildMentionActivity(currentUser?.email, taskRefs, threadsByTaskId);
  }, [taskRefs, threadQueries, currentUser?.email]);

  const isLoading =
    enabled &&
    (isLoadingChannels ||
      taskQueries.some((query) => query.isLoading) ||
      threadQueries.some((query) => query.isLoading));

  return { items, isLoading };
}
