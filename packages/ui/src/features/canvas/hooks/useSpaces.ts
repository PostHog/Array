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
const GESTURE_GAP_MS = 150;
// Travel before the gesture commits to an axis (horizontal vs vertical).
const AXIS_INTENT_PX = 12;
// Horizontal travel that triggers the switch.
const SWIPE_FIRE_PX = 50;
// A new intentional burst inside a still-live session: the horizontal delta
// must reach this many px AND this multiple of the recent horizontal level.
// Inertia decays smoothly, so it can never satisfy both; a fresh finger swipe
// spikes well past them.
const REARM_MIN_PX = 15;
const REARM_FACTOR = 2.5;
const RECENT_SAMPLES = 4;

interface SwipeSession {
  lastEventAt: number;
  totalX: number;
  totalY: number;
  axis: "x" | "y" | null;
  fired: boolean;
  /** Recent |deltaX| samples — the stream level re-arm bursts are judged against. */
  recentX: number[];
}

/**
 * Horizontal trackpad swipe → cycle spaces: exactly one space per swipe, and
 * every swipe counts.
 *
 * Wheel events carry no native intent-vs-inertia signal (the problem
 * use-gesture's docs point at Lethargy for), so this combines two mechanisms:
 *
 * 1. A gesture-session latch — events under GESTURE_GAP_MS apart form one
 *    session; the axis is decided once per session (diagonal scrolling can't
 *    flap) and it fires at most once, so an inertia tail can never re-fire.
 * 2. Lethargy-style burst re-arm — a horizontal delta that spikes well above
 *    the session's recent stream level is a NEW intent, so a swipe made while
 *    the previous one's inertia is still rolling (or right after vertical
 *    scrolling locked the session to "y") re-opens the session instead of
 *    being swallowed.
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
    recentX: [],
  });

  return useCallback(
    (event: React.WheelEvent) => {
      if (!enabled) return;
      const now = Date.now();
      const s = session.current;
      const deltaX = event.deltaX;
      const magnitudeX = Math.abs(deltaX);

      const resetSession = () => {
        s.totalX = 0;
        s.totalY = 0;
        s.axis = null;
        s.fired = false;
        s.recentX = [];
      };

      if (now - s.lastEventAt > GESTURE_GAP_MS) {
        resetSession();
      } else if (s.fired || s.axis === "y") {
        // The session is spent (fired) or committed to vertical scrolling —
        // but a horizontal burst far above the recent level means the user is
        // swiping again right now. Re-open for it.
        const recent = s.recentX.slice(-RECENT_SAMPLES);
        const average = recent.length
          ? recent.reduce((sum, value) => sum + value, 0) / recent.length
          : 0;
        if (
          magnitudeX >= REARM_MIN_PX &&
          magnitudeX >= REARM_FACTOR * Math.max(average, 1)
        ) {
          resetSession();
        }
      }

      s.lastEventAt = now;
      s.recentX.push(magnitudeX);
      if (s.recentX.length > RECENT_SAMPLES * 2) s.recentX.shift();
      s.totalX += deltaX;
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
