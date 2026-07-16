import { unreadChannelIds } from "@posthog/core/canvas/channelUnread";
import { useMentionActivity } from "@posthog/ui/features/canvas/hooks/useMentionActivity";
import { useChannelSeenStore } from "@posthog/ui/features/canvas/stores/channelSeenStore";
import { useMemo } from "react";

/**
 * Backend channel ids with activity the viewer hasn't seen. Shares the mentions
 * query with the Activity badge through the react-query cache, so mounting this
 * in the sidebar costs no extra fetch.
 */
export function useUnreadChannelIds(): Set<string> {
  const { items } = useMentionActivity();
  const lastSeenByChannel = useChannelSeenStore((s) => s.lastSeenByChannel);
  return useMemo(
    () => unreadChannelIds(items, lastSeenByChannel),
    [items, lastSeenByChannel],
  );
}
