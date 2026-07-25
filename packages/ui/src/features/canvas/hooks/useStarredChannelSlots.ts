import { useChannelStars } from "@posthog/ui/features/canvas/hooks/useChannelStars";
import {
  type Channel,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useMemo } from "react";

/** How many channels get a mod+N shortcut: #me plus the first eight starred. */
export const STARRED_HOTKEY_SLOTS = 9;

/**
 * The channels reachable by shortcut, in slot order — `#me` first, then starred.
 * One derivation shared by the handler that acts on a keypress and the switcher
 * that advertises the key, so the two can't drift apart.
 */
export function useStarredChannelSlots(): {
  /** Shortcut order. `slots[n - 1]` is the target of mod+n. */
  slots: Channel[];
  /** Everything without a shortcut, alphabetical. */
  rest: Channel[];
  /** 1-based slot for a channel, or undefined if it has no shortcut. */
  slotFor: (channel: Channel) => number | undefined;
} {
  const { channels } = useChannels();
  const { starredRefToShortcutId } = useChannelStars();

  return useMemo(() => {
    const me = channels.find((c) => c.name === PERSONAL_CHANNEL_NAME) ?? null;
    const byPath = new Map(channels.map((c) => [c.path, c]));
    const starred: Channel[] = [];
    for (const ref of starredRefToShortcutId.keys()) {
      const channel = byPath.get(ref);
      if (channel && channel.name !== PERSONAL_CHANNEL_NAME) {
        starred.push(channel);
      }
    }
    const slots = (me ? [me, ...starred] : starred).slice(
      0,
      STARRED_HOTKEY_SLOTS,
    );
    // Channels past the last slot still belong in the switcher, just without a
    // key — so build `rest` from every channel outside the slot list.
    const slotted = new Set(slots.map((c) => c.id));
    const rest = channels
      .filter((c) => !slotted.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const slotIndex = new Map(slots.map((c, index) => [c.id, index + 1]));
    return {
      slots,
      rest,
      slotFor: (channel: Channel) => slotIndex.get(channel.id),
    };
  }, [channels, starredRefToShortcutId]);
}
