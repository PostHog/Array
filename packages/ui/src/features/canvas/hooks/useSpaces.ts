import { useChannelStars } from "@posthog/ui/features/canvas/hooks/useChannelStars";
import {
  type Channel,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { useSpaceStore } from "@posthog/ui/features/canvas/stores/spaceStore";
import { navigateToChannel } from "@posthog/ui/router/navigationBridge";
import { useCallback, useMemo } from "react";

/**
 * The spaces in the Arc-style dot switcher: the user's starred channels (their
 * curated set), plus the current channel appended when it isn't starred — a
 * temporarily visited space, like opening an unstarred Arc space via search.
 */
export function useSpaces(): {
  spaces: Channel[];
  currentChannelId: string | null;
  currentIndex: number;
  switchTo: (channel: Channel) => void;
  cycle: (delta: 1 | -1) => void;
} {
  const { channels } = useChannels();
  const { starredRefToShortcutId } = useChannelStars();
  const currentChannelId = useSpaceStore((s) => s.currentChannelId);
  const setCurrentChannel = useSpaceStore((s) => s.setCurrentChannel);

  const spaces = useMemo(() => {
    const starred = channels.filter((c) => starredRefToShortcutId.has(c.path));
    const current = channels.find((c) => c.id === currentChannelId);
    if (current && !starred.some((c) => c.id === current.id)) {
      starred.push(current);
    }
    return starred;
  }, [channels, starredRefToShortcutId, currentChannelId]);

  const currentIndex = spaces.findIndex((c) => c.id === currentChannelId);

  const switchTo = useCallback(
    (channel: Channel) => {
      if (channel.id === currentChannelId) return;
      const from = spaces.findIndex((c) => c.id === currentChannelId);
      const to = spaces.findIndex((c) => c.id === channel.id);
      // Unknown positions (entering from the landing) read as moving right.
      const direction = from !== -1 && to !== -1 && to < from ? -1 : 1;
      setCurrentChannel(channel.id, direction);
      navigateToChannel(channel.id);
    },
    [spaces, currentChannelId, setCurrentChannel],
  );

  const cycle = useCallback(
    (delta: 1 | -1) => {
      if (spaces.length === 0) return;
      const from = currentIndex === -1 ? 0 : currentIndex;
      const next = spaces[(from + delta + spaces.length) % spaces.length];
      if (next) switchTo(next);
    },
    [spaces, currentIndex, switchTo],
  );

  return { spaces, currentChannelId, currentIndex, switchTo, cycle };
}
