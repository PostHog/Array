import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Per-space emoji, set from a dot's right-click menu. Pure view state persisted
 * to localStorage, keyed by channel id.
 */
interface SpaceEmojiState {
  emojiByChannelId: Record<string, string>;
  setEmoji: (channelId: string, emoji: string | null) => void;
}

export const useSpaceEmojiStore = create<SpaceEmojiState>()(
  persist(
    (set) => ({
      emojiByChannelId: {},
      setEmoji: (channelId, emoji) =>
        set((state) => {
          const next = { ...state.emojiByChannelId };
          if (emoji) {
            next[channelId] = emoji;
          } else {
            delete next[channelId];
          }
          return { emojiByChannelId: next };
        }),
    }),
    { name: "space-emoji" },
  ),
);
