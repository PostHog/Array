import type { TaskChannel } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

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
export function useTaskChannels(): {
  channels: TaskChannel[];
  personalChannel: TaskChannel | undefined;
  isLoading: boolean;
} {
  const query = useAuthenticatedQuery<TaskChannel[]>(
    TASK_CHANNELS_QUERY_KEY,
    (client) => client.getTaskChannels(),
    { refetchInterval: TASK_CHANNELS_POLL_INTERVAL_MS },
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
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();

  const existing = isPersonal
    ? personalChannel
    : channels.find(
        (c) => c.channel_type === "public" && c.name === normalized,
      );

  // Resolve-or-create is a POST, so it runs as a mutation fired once per
  // missing name — not a query TanStack would refire on focus/remount. The
  // result is merged into the channels-list cache, which stops the effect.
  const resolveMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!client) throw new Error("Not authenticated");
      return client.resolveTaskChannel(name);
    },
    onSuccess: (channel) => {
      queryClient.setQueryData<TaskChannel[]>(
        TASK_CHANNELS_QUERY_KEY,
        (prev) =>
          prev?.some((c) => c.id === channel.id)
            ? prev
            : [...(prev ?? []), channel],
      );
    },
  });
  const { mutate: resolve, isPending: isResolving } = resolveMutation;
  useEffect(() => {
    if (normalized && !isPersonal && !isLoading && !existing && !isResolving) {
      resolve(normalized);
    }
  }, [normalized, isPersonal, isLoading, existing, isResolving, resolve]);

  return {
    channel: existing,
    isLoading: isLoading || (!existing && isResolving),
  };
}
