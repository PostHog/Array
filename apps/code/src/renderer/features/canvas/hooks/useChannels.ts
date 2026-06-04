import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import type { Schemas } from "@renderer/api/generated";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

const CHANNELS_POLL_INTERVAL_MS = 30_000;
const CHANNELS_QUERY_KEY = ["canvas-channels"] as const;

/** A Home-space channel: a top-level folder on the desktop file system. */
export interface Channel {
  id: string;
  /** Display name — the channel's single-segment path. */
  name: string;
}

function toChannel(fs: Schemas.FileSystem): Channel {
  // Top-level channels have a single-segment path; strip any leading slash.
  return { id: fs.id, name: fs.path.replace(/^\/+/, "") };
}

/** List the project's channels (top-level desktop file-system folders). */
export function useChannels(options?: { enabled?: boolean }): {
  channels: Channel[];
  isLoading: boolean;
} {
  const query = useAuthenticatedQuery<Schemas.FileSystem[]>(
    CHANNELS_QUERY_KEY,
    (client) => client.getDesktopFileSystem(),
    {
      enabled: options?.enabled ?? true,
      refetchInterval: CHANNELS_POLL_INTERVAL_MS,
    },
  );
  const channels = (query.data ?? [])
    .filter((fs) => fs.type === "folder")
    .map(toChannel)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { channels, isLoading: query.isLoading };
}

/**
 * Create/delete channels. Both invalidate the shared query key so the list
 * refetches immediately rather than waiting on the poll.
 */
export function useChannelMutations() {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!client) throw new Error("Not authenticated");
      return client.createDesktopFileSystemChannel(name);
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) throw new Error("Not authenticated");
      return client.deleteDesktopFileSystem(id);
    },
    onSuccess: invalidate,
  });

  return {
    createChannel: (name: string) =>
      createMutation.mutateAsync(name).then(toChannel),
    deleteChannel: (id: string) => deleteMutation.mutateAsync(id),
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
