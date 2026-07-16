import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// When the viewer last had each channel open, keyed by backend channel id.
// Activity newer than this bolds the channel in the sidebar; opening the
// channel clears it. Per-channel (unlike the Activity page's single
// `lastSeenAt`) so reading one channel doesn't mark every other one read.
interface ChannelSeenState {
  lastSeenByChannel: Record<string, string>;
  markChannelSeen: (channelId: string, at: string) => void;
}

export const useChannelSeenStore = create<ChannelSeenState>()(
  persist(
    (set) => ({
      lastSeenByChannel: {},
      markChannelSeen: (channelId, at) =>
        set((state) => {
          // Never walk the timestamp backwards: a channel visited after its
          // newest activity is read, and re-stamping it with an older mention
          // would bold it again.
          const current = state.lastSeenByChannel[channelId];
          if (current && current >= at) return state;
          return {
            lastSeenByChannel: { ...state.lastSeenByChannel, [channelId]: at },
          };
        }),
    }),
    {
      name: "channels-seen",
      storage: electronStorage,
    },
  ),
);
