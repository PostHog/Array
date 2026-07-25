import {
  ANALYTICS_EVENTS,
  type SidebarLayout,
} from "@posthog/shared/analytics-events";
import { useChannelStars } from "@posthog/ui/features/canvas/hooks/useChannelStars";
import {
  type Channel,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { track } from "@posthog/ui/shell/analytics";
import { useEffect, useRef } from "react";

/**
 * Fires CHANNELS_SPACE_VIEWED once per entry into the channels space.
 *
 * Lives on the sidebar shell rather than the channel list, because the new
 * layout replaces that list with a per-channel sidebar — leaving the metric to
 * the list would drop space adoption to zero exactly when the flag turns on, and
 * read as a regression. `layout` distinguishes the two shells.
 */
export function useTrackChannelsSpaceViewed({
  enabled,
  layout,
}: {
  enabled: boolean;
  layout: SidebarLayout;
}): void {
  const { channels: allChannels, isLoading } = useChannels({ enabled });
  const { starredRefToShortcutId } = useChannelStars();

  // The "me" folder is the pinned personal row, not a shared channel.
  const shared = allChannels.filter(
    (c: Channel) => c.name !== PERSONAL_CHANNEL_NAME,
  );
  const channelCount = shared.length;
  const starredCount = shared.filter((c: Channel) =>
    starredRefToShortcutId.has(c.path),
  ).length;

  // Wait for the first load so the counts are real, then latch — the sidebar
  // stays mounted across channel navigation.
  const trackedRef = useRef(false);
  useEffect(() => {
    if (!enabled || isLoading || trackedRef.current) return;
    trackedRef.current = true;
    track(ANALYTICS_EVENTS.CHANNELS_SPACE_VIEWED, {
      channel_count: channelCount,
      starred_count: starredCount,
      layout,
    });
  }, [enabled, isLoading, channelCount, starredCount, layout]);
}
