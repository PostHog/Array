import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChannelHomeViewMode = "feed" | "board";
export type ChannelTaskScope = "all" | "me";

interface ChannelHomeUiStore {
  viewMode: ChannelHomeViewMode;
  setViewMode: (mode: ChannelHomeViewMode) => void;
  taskScope: ChannelTaskScope;
  setTaskScope: (scope: ChannelTaskScope) => void;
}

export const useChannelHomeUiStore = create<ChannelHomeUiStore>()(
  persist(
    (set) => ({
      viewMode: "feed",
      setViewMode: (viewMode) => set({ viewMode }),
      taskScope: "all",
      setTaskScope: (taskScope) => set({ taskScope }),
    }),
    {
      name: "channel-home-ui-store",
      storage: electronStorage,
    },
  ),
);
