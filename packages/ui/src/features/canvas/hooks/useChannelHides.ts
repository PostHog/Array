import type { Schemas } from "@posthog/api-client";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import {
  SHORTCUTS_POLL_INTERVAL_MS,
  SHORTCUTS_QUERY_KEY,
} from "@posthog/ui/features/canvas/hooks/useChannelStars";
import type { Channel } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { toast } from "@posthog/ui/primitives/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

// A hidden channel is a shortcut of its own type, distinct from the "folder"
// type that backs stars, so the two never collide on the shared shortcuts list.
const HIDDEN_SHORTCUT_TYPE = "hidden-folder";

/**
 * The current user's hidden channels, persisted in the PostHog backend as
 * per-user desktop file-system shortcuts (mirroring stars, with a distinct
 * type). Returns a map from a channel's raw path (the shortcut `ref`) to the
 * shortcut id, so callers can both check whether a channel is hidden and delete
 * the right shortcut when unhiding.
 */
export function useChannelHides(options?: { enabled?: boolean }): {
  hiddenRefToShortcutId: Map<string, string>;
  isLoading: boolean;
} {
  const query = useAuthenticatedQuery<Schemas.FileSystemShortcut[]>(
    SHORTCUTS_QUERY_KEY,
    (client) => client.getDesktopFileSystemShortcuts(),
    {
      enabled: options?.enabled ?? true,
      refetchInterval: SHORTCUTS_POLL_INTERVAL_MS,
    },
  );

  const hiddenRefToShortcutId = new Map<string, string>();
  for (const shortcut of query.data ?? []) {
    if (shortcut.type === HIDDEN_SHORTCUT_TYPE && shortcut.ref) {
      hiddenRefToShortcutId.set(shortcut.ref, shortcut.id);
    }
  }

  return { hiddenRefToShortcutId, isLoading: query.isLoading };
}

/**
 * Hide/unhide a channel by creating or deleting its desktop shortcut. Both
 * paths update the shared shortcuts cache immediately so the sidebar re-groups
 * the instant the request resolves, rather than waiting on the poll.
 */
export function useChannelHideMutations() {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SHORTCUTS_QUERY_KEY });
  }, [queryClient]);

  const hideMutation = useMutation({
    mutationFn: async (channel: Channel) => {
      if (!client) throw new Error("Not authenticated");
      return client.createDesktopFileSystemShortcut({
        path: channel.name,
        type: HIDDEN_SHORTCUT_TYPE,
        ref: channel.path,
      });
    },
    onSuccess: (created) => {
      queryClient.setQueryData<Schemas.FileSystemShortcut[]>(
        SHORTCUTS_QUERY_KEY,
        (old) => {
          if (!old) return [created];
          if (old.some((s) => s.id === created.id)) return old;
          return [...old, created];
        },
      );
      invalidate();
    },
  });

  const unhideMutation = useMutation({
    mutationFn: async (shortcutId: string) => {
      if (!client) throw new Error("Not authenticated");
      await client.deleteDesktopFileSystemShortcut(shortcutId);
      return shortcutId;
    },
    onSuccess: (shortcutId) => {
      queryClient.setQueryData<Schemas.FileSystemShortcut[]>(
        SHORTCUTS_QUERY_KEY,
        (old) => (old ?? []).filter((s) => s.id !== shortcutId),
      );
      invalidate();
    },
  });

  return {
    hide: (channel: Channel) => hideMutation.mutateAsync(channel),
    unhide: (shortcutId: string) => unhideMutation.mutateAsync(shortcutId),
    isHiding: hideMutation.isPending,
    isUnhiding: unhideMutation.isPending,
  };
}

/**
 * Per-channel hidden state plus the actions a channel row needs. Wraps the
 * shared shortcuts query and mutations so the row components stay declarative.
 * Multiple rows calling this share one underlying query (React Query dedupes by
 * key).
 */
export function useChannelHideToggle(channel: Channel): {
  isHidden: boolean;
  toggleHidden: () => void;
  /** Remove the hidden marker if present — used when the channel itself is
   *  deleted so a same-named channel created later doesn't inherit it. */
  removeHidden: () => void;
} {
  const { hiddenRefToShortcutId } = useChannelHides();
  const { hide, unhide, isHiding, isUnhiding } = useChannelHideMutations();
  const shortcutId = hiddenRefToShortcutId.get(channel.path);
  const isHidden = shortcutId !== undefined;

  const toggleHidden = useCallback(() => {
    // Ignore re-clicks while a hide/unhide is in flight. The cache only updates
    // once the request resolves, so without this guard a quick double-tap would
    // fire two creates for the same path — leaving a duplicate marker that a
    // single later unhide can't fully clear.
    if (isHiding || isUnhiding) return;
    const run = shortcutId ? unhide(shortcutId) : hide(channel);
    run.catch((error: unknown) => {
      toast.error(
        isHidden ? "Couldn't unhide channel" : "Couldn't hide channel",
        {
          description: error instanceof Error ? error.message : String(error),
        },
      );
    });
  }, [channel, shortcutId, isHidden, hide, unhide, isHiding, isUnhiding]);

  const removeHidden = useCallback(() => {
    if (shortcutId) {
      // Best-effort cleanup when the channel is deleted; swallow failures so a
      // rejected delete doesn't surface as an unhandled rejection.
      void unhide(shortcutId).catch(() => {});
    }
  }, [shortcutId, unhide]);

  return { isHidden, toggleHidden, removeHidden };
}
