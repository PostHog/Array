import type { TaskChannel } from "@posthog/shared/domain-types";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useMemo } from "react";

const TASK_CHANNELS_POLL_INTERVAL_MS = 30_000;
export const TASK_CHANNELS_QUERY_KEY = ["task-channels"] as const;

/** Name reserved for the personal channel; mirrors the backend constant. */
export const PERSONAL_CHANNEL_NAME = "me";

/** Client-side mirror of the backend's channel-name normalization. */
export function normalizeChannelName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 128);
}

/**
 * Backend task channels — the feed/ownership side of a channel (the sidebar's
 * folder "channels" stay on the desktop file system for CONTEXT.md and
 * artifacts). Listing also lazily provisions the requester's #me channel.
 */
export function useTaskChannels(options?: { enabled?: boolean }): {
  channels: TaskChannel[];
  personalChannel: TaskChannel | undefined;
  isLoading: boolean;
} {
  const query = useAuthenticatedQuery<TaskChannel[]>(
    TASK_CHANNELS_QUERY_KEY,
    (client) => client.getTaskChannels(),
    {
      enabled: options?.enabled ?? true,
      refetchInterval: TASK_CHANNELS_POLL_INTERVAL_MS,
    },
  );
  const channels = useMemo(() => query.data ?? [], [query.data]);
  const personalChannel = useMemo(
    () => channels.find((c) => c.channel_type === "personal"),
    [channels],
  );
  return { channels, personalChannel, isLoading: query.isLoading };
}

/**
 * Map a folder channel (by display name) onto its backend channel. The "me"
 * folder is the bridge for the personal channel; any other name resolves (or
 * creates) the matching public channel, so feeds keep working for channels
 * created before backend channels existed.
 */
export function useBackendChannel(channelName: string | undefined): {
  channel: TaskChannel | undefined;
  isLoading: boolean;
} {
  const normalized = channelName ? normalizeChannelName(channelName) : "";
  const isPersonal = normalized === PERSONAL_CHANNEL_NAME;
  const { channels, personalChannel, isLoading } = useTaskChannels();

  const existing = isPersonal
    ? personalChannel
    : channels.find(
        (c) => c.channel_type === "public" && c.name === normalized,
      );

  // resolve is idempotent server-side (get_or_create), so running it as a
  // query keyed on the name is safe and self-deduplicating.
  const resolveQuery = useAuthenticatedQuery<TaskChannel>(
    ["task-channel-resolve", normalized],
    (client) => client.resolveTaskChannel(normalized),
    { enabled: !!normalized && !isPersonal && !isLoading && !existing },
  );

  return {
    channel: existing ?? resolveQuery.data ?? undefined,
    isLoading: isLoading || (!existing && resolveQuery.isLoading),
  };
}
