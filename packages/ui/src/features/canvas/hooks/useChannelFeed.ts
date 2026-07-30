import type { Task } from "@posthog/shared/domain-types";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useMemo } from "react";
import {
  SPACE_QUERY_GC_TIME_MS,
  SPACE_QUERY_STALE_TIME_MS,
} from "./spaceQueryPolicy";

// Feeds are multiplayer: poll fast enough that a teammate's new task card and
// run-status flips feel live without a dedicated push channel.
const CHANNEL_FEED_POLL_INTERVAL_MS = 5_000;
export const channelFeedQueryRoot = ["channel-feed"] as const;

export function channelFeedQueryKey(channelId: string | undefined) {
  return [...channelFeedQueryRoot, channelId ?? "none"] as const;
}

/**
 * A channel's task feed, oldest first (Slack ordering — the composer sits at
 * the bottom and new cards land above it).
 *
 * Archived tasks are dropped here rather than in each view. Archiving is a
 * local, per-device record, so the cloud feed keeps returning an archived task
 * forever: any surface that renders this list raw shows a card the user has
 * already archived, which reads as the archive having done nothing.
 */
export function useChannelFeed(channelId: string | undefined): {
  tasks: Task[];
  isLoading: boolean;
} {
  const query = useAuthenticatedQuery<Task[]>(
    channelFeedQueryKey(channelId),
    (client) =>
      client.getTasks({ channel: channelId }) as unknown as Promise<Task[]>,
    {
      enabled: !!channelId,
      gcTime: SPACE_QUERY_GC_TIME_MS,
      refetchInterval: CHANNEL_FEED_POLL_INTERVAL_MS,
      staleTime: SPACE_QUERY_STALE_TIME_MS,
    },
  );
  const archivedTaskIds = useArchivedTaskIds();
  const tasks = useMemo(
    () =>
      (query.data ?? [])
        .filter((task) => !archivedTaskIds.has(task.id))
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [query.data, archivedTaskIds],
  );
  return { tasks, isLoading: query.isLoading };
}
