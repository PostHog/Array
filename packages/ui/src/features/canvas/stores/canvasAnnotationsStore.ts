import type { CanvasAnnotationTarget } from "@posthog/core/canvas/freeformSchemas";
import { create } from "zustand";

// The queued canvas annotations ("comment mode"): targets captured by the
// sandbox overlay, each with a host-side comment, keyed per canvas. Pure view
// state — the queue drains into the next generation instruction on submit.
export interface QueuedCanvasAnnotation {
  id: string;
  target: CanvasAnnotationTarget;
  comment: string;
}

interface CanvasAnnotationsStore {
  byDashboard: Record<string, QueuedCanvasAnnotation[]>;
  add: (dashboardId: string, target: CanvasAnnotationTarget) => void;
  setComment: (dashboardId: string, id: string, comment: string) => void;
  remove: (dashboardId: string, id: string) => void;
  clear: (dashboardId: string) => void;
}

export const useCanvasAnnotationsStore = create<CanvasAnnotationsStore>()(
  (set) => ({
    byDashboard: {},
    add: (dashboardId, target) =>
      set((s) => ({
        byDashboard: {
          ...s.byDashboard,
          [dashboardId]: [
            ...(s.byDashboard[dashboardId] ?? []),
            { id: crypto.randomUUID(), target, comment: "" },
          ],
        },
      })),
    setComment: (dashboardId, id, comment) =>
      set((s) => ({
        byDashboard: {
          ...s.byDashboard,
          [dashboardId]: (s.byDashboard[dashboardId] ?? []).map((a) =>
            a.id === id ? { ...a, comment } : a,
          ),
        },
      })),
    remove: (dashboardId, id) =>
      set((s) => ({
        byDashboard: {
          ...s.byDashboard,
          [dashboardId]: (s.byDashboard[dashboardId] ?? []).filter(
            (a) => a.id !== id,
          ),
        },
      })),
    clear: (dashboardId) =>
      set((s) => ({
        byDashboard: { ...s.byDashboard, [dashboardId]: [] },
      })),
  }),
);

const EMPTY: QueuedCanvasAnnotation[] = [];

/** The queued annotations for one canvas (stable empty array when none). */
export function useCanvasAnnotations(
  dashboardId: string,
): QueuedCanvasAnnotation[] {
  return useCanvasAnnotationsStore((s) => s.byDashboard[dashboardId] ?? EMPTY);
}
