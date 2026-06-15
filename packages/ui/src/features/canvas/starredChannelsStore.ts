import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// User-specific starred channels, surfaced in a "Starred" section at the top of
// the channel list. Persisted per device via the host storage backend — the
// same approach the rest of the canvas view state uses. Channel ids are unique
// across projects, so a flat list needs no per-project scoping.
interface StarredChannelsStore {
  starredIds: string[];
  isStarred: (channelId: string) => boolean;
  toggle: (channelId: string) => void;
  unstar: (channelId: string) => void;
}

export const useStarredChannelsStore = create<StarredChannelsStore>()(
  persist(
    (set, get) => ({
      starredIds: [],
      isStarred: (channelId) => get().starredIds.includes(channelId),
      toggle: (channelId) =>
        set((state) => ({
          starredIds: state.starredIds.includes(channelId)
            ? state.starredIds.filter((id) => id !== channelId)
            : [...state.starredIds, channelId],
        })),
      unstar: (channelId) =>
        set((state) => ({
          starredIds: state.starredIds.filter((id) => id !== channelId),
        })),
    }),
    {
      name: "canvas-starred-channels",
      storage: electronStorage,
      partialize: (state) => ({ starredIds: state.starredIds }),
    },
  ),
);
