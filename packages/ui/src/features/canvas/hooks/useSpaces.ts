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
      // Clamp at the ends — wrapping around reads as the switcher jumping
      // randomly when you swipe past the last space.
      const from = currentIndex === -1 ? (delta > 0 ? -1 : 1) : currentIndex;
      const nextIndex = Math.max(0, Math.min(spaces.length - 1, from + delta));
      if (nextIndex === currentIndex) return;
      const next = spaces[nextIndex];
      if (next) switchTo(next);
    },
    [spaces, currentIndex, switchTo],
  );

  return { spaces, currentChannelId, currentIndex, switchTo, cycle };
}

// Gesture-session swipe tuning. A "gesture" is a run of wheel events with no
// gap longer than GESTURE_GAP_MS between them — macOS inertia events arrive
// well inside that gap, so a whole fling (fingers + momentum) is one session.
// Kept short enough that two deliberate back-to-back swipes register as two
// gestures; a dying inertia tail that sneaks past the gap can't re-fire
// because its tiny deltas never reach the fire threshold.
const GESTURE_GAP_MS = 150;
// Travel before the gesture commits to an axis (horizontal vs vertical).
const AXIS_INTENT_PX = 12;
// Horizontal travel that triggers the switch.
const SWIPE_FIRE_PX = 60;

interface SwipeSession {
  lastEventAt: number;
  totalX: number;
  totalY: number;
  axis: "x" | "y" | null;
  fired: boolean;
}

/**
 * Horizontal trackpad swipe → cycle spaces, strictly one space per gesture.
 *
 * Wheel events carry no native intent-vs-inertia signal (the same problem
 * use-gesture's docs point at Lethargy for), so this uses a gesture-session
 * latch: events separated by less than GESTURE_GAP_MS belong to one session;
 * each session decides its axis exactly once (so diagonal scrolling can't
 * flap between "scroll" and "swipe"), fires at most once, and stays latched —
 * inertia included — until true quiet ends the session.
 */
export function useSpaceSwipe(
  enabled: boolean,
): (event: React.WheelEvent) => void {
  const { cycle } = useSpaces();
  const session = useRef<SwipeSession>({
    lastEventAt: 0,
    totalX: 0,
    totalY: 0,
    axis: null,
    fired: false,
  });

  return useCallback(
    (event: React.WheelEvent) => {
      if (!enabled) return;
      const now = Date.now();
      const s = session.current;
      if (now - s.lastEventAt > GESTURE_GAP_MS) {
        s.totalX = 0;
        s.totalY = 0;
        s.axis = null;
        s.fired = false;
      }
      s.lastEventAt = now;
      s.totalX += event.deltaX;
      s.totalY += event.deltaY;
      if (s.fired) return;
      if (s.axis === null) {
        if (
          Math.abs(s.totalX) < AXIS_INTENT_PX &&
          Math.abs(s.totalY) < AXIS_INTENT_PX
        ) {
          return;
        }
        s.axis = Math.abs(s.totalX) > Math.abs(s.totalY) * 1.2 ? "x" : "y";
      }
      if (s.axis !== "x") return;
      if (Math.abs(s.totalX) >= SWIPE_FIRE_PX) {
        s.fired = true;
        cycle(s.totalX > 0 ? 1 : -1);
      }
    },
    [enabled, cycle],
  );
}
