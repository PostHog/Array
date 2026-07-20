import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const DEFAULT_PANEL_WIDTH = 360;

/**
 * The Activity page's key in `openByChannel`. Threads are keyed by channel, but
 * Activity spans every channel, and borrowing a real channel's key would mean
 * reading a mention there silently changed which thread that channel shows.
 * Channel ids are UUIDs, so this can't collide with one.
 */
export const ACTIVITY_THREAD_KEY = "activity";

interface ThreadPanelState {
  openByChannel: Record<string, string | null>;
  collapsed: boolean;
  width: number;
  openThread: (
    channelId: string,
    taskId: string,
    opts?: { expand?: boolean },
  ) => void;
  closeThread: (channelId: string) => void;
  setCollapsed: (collapsed: boolean) => void;
  setWidth: (width: number) => void;
}

export const useThreadPanelStore = create<ThreadPanelState>()(
  persist(
    (set) => ({
      openByChannel: {},
      collapsed: false,
      width: DEFAULT_PANEL_WIDTH,
      openThread: (channelId, taskId, opts) =>
        set((state) => ({
          openByChannel: { ...state.openByChannel, [channelId]: taskId },
          ...(opts?.expand === false ? {} : { collapsed: false }),
        })),
      closeThread: (channelId) =>
        set((state) => ({
          openByChannel: { ...state.openByChannel, [channelId]: null },
        })),
      setCollapsed: (collapsed) => set({ collapsed }),
      setWidth: (width) => set({ width }),
    }),
    {
      name: "thread-panel-storage",
      storage: electronStorage,
      partialize: (state) => ({
        collapsed: state.collapsed,
        width: state.width,
      }),
    },
  ),
);
