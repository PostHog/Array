import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// View state for the thread side panel — the right-hand human conversation
// dock next to a channel feed or task detail. Which thread is open is
// per-navigation state; collapse and width are persisted user preferences so
// the panel keeps its shape across tasks and channels.
const DEFAULT_PANEL_WIDTH = 360;

interface ThreadPanelState {
  /** Task whose thread is open, or null when the panel is closed. */
  taskId: string | null;
  collapsed: boolean;
  width: number;
  /** Points the panel at a task; expands it unless `expand: false`. */
  openThread: (taskId: string, opts?: { expand?: boolean }) => void;
  closeThread: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setWidth: (width: number) => void;
}

export const useThreadPanelStore = create<ThreadPanelState>()(
  persist(
    (set) => ({
      taskId: null,
      collapsed: false,
      width: DEFAULT_PANEL_WIDTH,
      openThread: (taskId, opts) =>
        set(opts?.expand === false ? { taskId } : { taskId, collapsed: false }),
      closeThread: () => set({ taskId: null }),
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
