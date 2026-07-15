import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import type { TaskChannel } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { toast } from "@posthog/ui/primitives/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";

const TASK_CHANNELS_POLL_INTERVAL_MS = 30_000;
export const TASK_CHANNELS_QUERY_KEY = ["task-channels"] as const;

/** Name reserved for the personal channel; mirrors the backend constant. */
export const PERSONAL_CHANNEL_NAME = "me";

/** Client-side mirror of the backend's channel-name normalization. */
export function normalizeChannelName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 128);
}

/**
 * Imperative twin of `useBackendChannel`, for flows with no mounted hook (e.g.
 * launching a task right after creating a context): map a folder channel's
 * display name onto its backend channel id. The "me" folder maps to the
 * personal channel; any other name resolve-or-creates its public channel.
 */
export async function resolveBackendChannelId(
  client: PostHogAPIClient | null,
  channelName: string,
): Promise<string | undefined> {
  if (!client) return undefined;
  const normalized = normalizeChannelName(channelName);
  if (!normalized) return undefined;
  if (normalized === PERSONAL_CHANNEL_NAME) {
    const channels = await client.getTaskChannels();
    return channels.find((c) => c.channel_type === "personal")?.id;
  }
  return (await client.resolveTaskChannel(normalized)).id;
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
 * Rename a folder channel's backend channel so its task feed/history follows a
 * rename. The folder and its backend channel are bridged by name only, so
 * without this the feed re-resolves to a different (empty) channel and the
 * history appears lost. Renames the existing public channel matching the old
 * name to the new name, updating the channels cache first so a mounted
 * `useBackendChannel(newName)` matches the existing channel and doesn't
 * resolve-or-create an empty duplicate.
 *
 * Best-effort and never throws: a failed follow must not turn a successful
 * folder rename into an error. No-op for the personal channel, an unchanged
 * name, or a channel with no backend channel yet (nothing to carry over).
 */
export function useRenameBackendChannel(): (
  oldName: string,
  newName: string,
) => Promise<void> {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();

  return useCallback(
    async (oldName: string, newName: string) => {
      if (!client) return;
      const oldNormalized = normalizeChannelName(oldName);
      const newNormalized = normalizeChannelName(newName);
      if (
        !oldNormalized ||
        !newNormalized ||
        oldNormalized === newNormalized ||
        oldNormalized === PERSONAL_CHANNEL_NAME ||
        newNormalized === PERSONAL_CHANNEL_NAME
      ) {
        return;
      }

      // Prefer the cache (populated when the channel is on screen, so the
      // rename is race-free against the feed's name lookup); fall back to a
      // fetch otherwise (nothing is resolving that channel, so no race).
      const cached = queryClient.getQueryData<TaskChannel[]>(
        TASK_CHANNELS_QUERY_KEY,
      );
      const findPublic = (list: TaskChannel[]) =>
        list.find(
          (c) => c.channel_type === "public" && c.name === oldNormalized,
        );
      let existing = cached ? findPublic(cached) : undefined;
      if (!existing && !cached) {
        try {
          existing = findPublic(await client.getTaskChannels());
        } catch {
          return;
        }
      }
      if (!existing) return; // No backend channel/history to carry over.

      const staleId = existing.id;
      const previous = existing;
      // Optimistically rename in-cache so the feed's name lookup resolves to
      // this channel immediately once the folder name flips.
      queryClient.setQueryData<TaskChannel[]>(TASK_CHANNELS_QUERY_KEY, (prev) =>
        prev?.map((c) =>
          c.id === staleId ? { ...c, name: newNormalized } : c,
        ),
      );
      try {
        const updated = await client.renameTaskChannel(staleId, newNormalized);
        queryClient.setQueryData<TaskChannel[]>(
          TASK_CHANNELS_QUERY_KEY,
          (prev) => prev?.map((c) => (c.id === updated.id ? updated : c)),
        );
      } catch (error) {
        // Roll back the optimistic rename so the feed doesn't point at a name
        // the backend never accepted.
        queryClient.setQueryData<TaskChannel[]>(
          TASK_CHANNELS_QUERY_KEY,
          (prev) => prev?.map((c) => (c.id === staleId ? previous : c)),
        );
        toast.error("Couldn't move context history to the new name", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [client, queryClient],
  );
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
