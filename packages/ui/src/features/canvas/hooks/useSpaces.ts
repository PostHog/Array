import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useChannelStars } from "@posthog/ui/features/canvas/hooks/useChannelStars";
import {
  type Channel,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useSpaceStore } from "@posthog/ui/features/canvas/stores/spaceStore";
import { navigateToChannel } from "@posthog/ui/router/navigationBridge";
import { track } from "@posthog/ui/shell/analytics";
import { useCallback, useMemo, useRef } from "react";

/** What drove a space switch, for analytics. */
export type SpaceSwitchMethod =
  | "dot"
  | "swipe"
  | "keyboard"
  | "browse"
  | "draft"
  | "me";

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
  switchTo: (channel: Channel, method?: SpaceSwitchMethod) => void;
  cycle: (delta: 1 | -1, method?: SpaceSwitchMethod) => void;
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
    (channel: Channel, method: SpaceSwitchMethod = "dot") => {
      // Re-selecting the current space still goes through setCurrentChannel:
      // it dismisses the browse/draft overrides and lands on the channel home.
      const from = spaces.findIndex((c) => c.id === currentChannelId);
      const to = spaces.findIndex((c) => c.id === channel.id);
      // Unknown positions (entering from the landing) read as moving right.
      const direction = from !== -1 && to !== -1 && to < from ? -1 : 1;
      setCurrentChannel(channel.id, direction);
      navigateToChannel(channel.id);
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "space_switch",
        surface: "space_switcher",
        channel_id: channel.id,
        method,
      });
    },
    [spaces, currentChannelId, setCurrentChannel],
  );

  const cycle = useCallback(
    (delta: 1 | -1, method: SpaceSwitchMethod = "keyboard") => {
      if (spaces.length === 0) return;
      // Clamp at the ends — wrapping around reads as the switcher jumping
      // randomly when you swipe past the last space.
      const from = currentIndex === -1 ? (delta > 0 ? -1 : 1) : currentIndex;
      const nextIndex = Math.max(0, Math.min(spaces.length - 1, from + delta));
      if (nextIndex === currentIndex) return;
      const next = spaces[nextIndex];
      if (next) switchTo(next, method);
    },
    [spaces, currentIndex, switchTo],
  );

  return { spaces, currentChannelId, currentIndex, switchTo, cycle };
}

// Swipe tuning. macOS "switch desktop" semantics: one swipe = one space,
// regardless of speed. A trackpad swipe is a burst of wheel events (fingers +
// a long, decaying inertia tail); the whole burst must move exactly one space.
//
// Two guards together make a single fire impossible to beat, without trying to
// classify inertia vs. intent (which timing alone can't do reliably):
//   1. QUIET_GAP — after firing, stay locked until the wheel is silent this
//      long. A continuous inertia tail never goes silent, so it stays locked.
//   2. MIN_FIRE_INTERVAL — a hard floor between two switches. Even if the tail
//      *does* have a gap longer than QUIET_GAP (some trackpads emit sparse
//      late-inertia events), a second switch can't fire until this has passed,
//      and by then the tail's velocity is spent — with the accumulator reset
//      on every fire, the dregs can't re-reach the threshold.
// The cost is that two *deliberate* swipes need ~half a second between them,
// which is fine for discrete space switching and the price of never over-shooting.
const QUIET_GAP_MS = 400;
const MIN_FIRE_INTERVAL_MS = 500;
// Horizontal travel within one gesture that triggers the switch.
const FIRE_PX = 40;

interface SwipeGate {
  lastEventAt: number;
  firedAt: number;
  accumX: number;
  locked: boolean;
}

/**
 * Horizontal trackpad swipe → cycle spaces, exactly one space per swipe.
 * Attach the returned handler via `onWheel`.
 */
export function useSpaceSwipe(
  enabled: boolean,
): (event: React.WheelEvent) => void {
  const { cycle } = useSpaces();
  const gate = useRef<SwipeGate>({
    lastEventAt: 0,
    firedAt: 0,
    accumX: 0,
    locked: false,
  });

  return useCallback(
    (event: React.WheelEvent) => {
      if (!enabled) return;
      const now = Date.now();
      const g = gate.current;
      const gap = now - g.lastEventAt;
      g.lastEventAt = now;

      if (g.locked) {
        // Release only once the wheel has gone quiet AND the hard floor since
        // the last switch has passed — inertia can satisfy neither.
        if (gap > QUIET_GAP_MS && now - g.firedAt > MIN_FIRE_INTERVAL_MS) {
          g.locked = false;
          g.accumX = 0;
        } else {
          return;
        }
      } else if (gap > QUIET_GAP_MS) {
        // Fresh gesture after a real pause.
        g.accumX = 0;
      }

      // Only horizontal-dominant events count; vertical scrolling is ignored.
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;

      g.accumX += event.deltaX;
      if (Math.abs(g.accumX) >= FIRE_PX) {
        const direction = g.accumX > 0 ? 1 : -1;
        g.locked = true;
        g.firedAt = now;
        g.accumX = 0;
        cycle(direction, "swipe");
      }
    },
    [enabled, cycle],
  );
}
