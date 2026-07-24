import { useChannelStars } from "@posthog/ui/features/canvas/hooks/useChannelStars";
import {
  type Channel,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useSpaceStore } from "@posthog/ui/features/canvas/stores/spaceStore";
import { navigateToChannel } from "@posthog/ui/router/navigationBridge";
import { useCallback, useMemo, useRef } from "react";

/**
 * The spaces in the Arc-style dot switcher: the personal "#me" channel always
 * first, then the user's starred channels (their curated set), plus the
 * current channel appended when it isn't one of those — a temporarily visited
 * space, like opening an unstarred Arc space via search.
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
    const me = channels.find((c) => c.name === PERSONAL_CHANNEL_NAME);
    // Star order, not name order: the shortcuts map preserves creation order,
    // so a newly added space always lands at the right end of the dot row.
    const byPath = new Map(channels.map((c) => [c.path, c]));
    const starred: Channel[] = [];
    for (const ref of starredRefToShortcutId.keys()) {
      const channel = byPath.get(ref);
      if (channel && channel.name !== PERSONAL_CHANNEL_NAME) {
        starred.push(channel);
      }
    }
    const list = me ? [me, ...starred] : starred;
    const current = channels.find((c) => c.id === currentChannelId);
    if (current && !list.some((c) => c.id === current.id)) {
      list.push(current);
    }
    return list;
  }, [channels, starredRefToShortcutId, currentChannelId]);

  const currentIndex = spaces.findIndex((c) => c.id === currentChannelId);

  const switchTo = useCallback(
    (channel: Channel) => {
      // Re-selecting the current space still goes through setCurrentChannel:
      // it dismisses the browse/draft overrides and lands on the channel home.
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

// How much horizontal trackpad travel counts as a space swipe, and how long
// the gesture must go quiet before another swipe can fire.
const SWIPE_THRESHOLD = 90;
const SWIPE_QUIET_MS = 300;
const SWIPE_RESET_MS = 300;

/**
 * Horizontal trackpad swipe → cycle spaces, strictly one space per gesture:
 * after a move fires, every further wheel event of the same gesture (macOS
 * inertia included) keeps a quiet-period lock alive, so even a very fast
 * fling moves exactly one space. Attach the returned handler via `onWheel`.
 */
export function useSpaceSwipe(
  enabled: boolean,
): (event: React.WheelEvent) => void {
  const { cycle } = useSpaces();
  const accum = useRef(0);
  const lockUntil = useRef(0);
  const lastEvent = useRef(0);

  return useCallback(
    (event: React.WheelEvent) => {
      if (!enabled) return;
      // Mostly-vertical wheel = list scrolling, never a space switch.
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      const now = Date.now();
      if (now < lockUntil.current) {
        // Same gesture still rolling — extend the lock so it can't re-fire.
        lockUntil.current = now + SWIPE_QUIET_MS;
        return;
      }
      if (now - lastEvent.current > SWIPE_RESET_MS) accum.current = 0;
      lastEvent.current = now;
      accum.current += event.deltaX;
      if (Math.abs(accum.current) >= SWIPE_THRESHOLD) {
        cycle(accum.current > 0 ? 1 : -1);
        accum.current = 0;
        lockUntil.current = now + SWIPE_QUIET_MS;
      }
    },
    [enabled, cycle],
  );
}
