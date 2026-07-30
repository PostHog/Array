import { buildRecentItems } from "@posthog/core/canvas/recentItems";
import { useRecentDashboards } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useRecentCanvasStore } from "@posthog/ui/features/canvas/stores/recentCanvasStore";
import { useTaskViewed } from "@posthog/ui/features/sidebar/useTaskViewed";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { useMemo } from "react";

export function useRecentItems() {
  const { data: tasks = [], isLoading: tasksLoading } = useTasks({
    showAllUsers: true,
  });
  const { timestamps, isLoading: timestampsLoading } = useTaskViewed();
  const { dashboards, isLoading: dashboardsLoading } = useRecentDashboards();
  const canvasViewedAt = useRecentCanvasStore((state) => state.viewedAt);
  const items = useMemo(
    () =>
      buildRecentItems({
        tasks,
        dashboards,
        taskTimestamps: timestamps,
        canvasViewedAt,
      }),
    [tasks, dashboards, timestamps, canvasViewedAt],
  );
  return {
    items,
    isLoading: tasksLoading || timestampsLoading || dashboardsLoading,
  };
}
