import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChannelHomeViewMode = "feed" | "board";

interface ChannelHomeUiStore {
  viewMode: ChannelHomeViewMode;
  setViewMode: (mode: ChannelHomeViewMode) => void;
}

export const useChannelHomeUiStore = create<ChannelHomeUiStore>()(
  persist(
    (set) => ({
      viewMode: "feed",
      setViewMode: (viewMode) => set({ viewMode }),
    }),
    {
      name: "channel-home-ui-store",
      storage: electronStorage,
    },
  ),
);
