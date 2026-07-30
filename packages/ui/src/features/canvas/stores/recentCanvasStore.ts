import { create } from "zustand";
import { persist } from "zustand/middleware";

interface RecentCanvasState {
  viewedAt: Record<string, number>;
  markViewed: (dashboardId: string) => void;
}

export const useRecentCanvasStore = create<RecentCanvasState>()(
  persist(
    (set) => ({
      viewedAt: {},
      markViewed: (dashboardId) =>
        set((state) => {
          const entries = Object.entries({
            ...state.viewedAt,
            [dashboardId]: Date.now(),
          })
            .sort(([, a], [, b]) => b - a)
            .slice(0, 100);
          return { viewedAt: Object.fromEntries(entries) };
        }),
    }),
    { name: "posthog-code-recent-canvases" },
  ),
);
