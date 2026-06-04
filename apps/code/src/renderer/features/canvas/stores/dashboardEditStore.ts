import { create } from "zustand";

interface DashboardEditState {
  // Per-dashboard edit toggle: when on, the dashboard shows its gen-UI canvas
  // + chat input instead of the dashboard tiles.
  editing: Record<string, boolean>;
  toggle: (dashboardId: string) => void;
}

export const useDashboardEditStore = create<DashboardEditState>((set) => ({
  editing: {},
  toggle: (dashboardId) =>
    set((s) => ({
      editing: { ...s.editing, [dashboardId]: !s.editing[dashboardId] },
    })),
}));

export function useIsDashboardEditing(dashboardId: string): boolean {
  return useDashboardEditStore((s) => !!s.editing[dashboardId]);
}
