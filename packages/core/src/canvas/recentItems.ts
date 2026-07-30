import type { Task } from "@posthog/shared/domain-types";
import type { TaskTimestamps } from "../sidebar/taskMeta";
import type { DashboardSummary } from "./dashboardSchemas";

export const RECENT_ITEMS_LIMIT = 20;

export type RecentItem =
  | {
      kind: "task";
      id: string;
      title: string;
      engagedAt: number;
    }
  | {
      kind: "canvas";
      id: string;
      channelId: string;
      title: string;
      templateId: string;
      engagedAt: number;
    };

export function buildRecentItems({
  tasks,
  dashboards,
  taskTimestamps,
  canvasViewedAt = {},
  limit = RECENT_ITEMS_LIMIT,
}: {
  tasks: readonly Task[];
  dashboards: readonly DashboardSummary[];
  taskTimestamps: Readonly<Record<string, TaskTimestamps>>;
  canvasViewedAt?: Readonly<Record<string, number>>;
  limit?: number;
}): RecentItem[] {
  const taskItems = tasks.flatMap<RecentItem>((task) => {
    const timestamps = taskTimestamps[task.id];
    const engagedAt = Math.max(
      timestamps?.lastViewedAt ?? 0,
      timestamps?.lastActivityAt ?? 0,
    );
    return engagedAt > 0
      ? [{ kind: "task", id: task.id, title: task.title, engagedAt }]
      : [];
  });
  const canvasItems = dashboards.flatMap<RecentItem>((dashboard) => {
    const engagedAt = canvasViewedAt[dashboard.id] ?? 0;
    return engagedAt > 0
      ? [
          {
            kind: "canvas",
            id: dashboard.id,
            channelId: dashboard.channelId,
            title: dashboard.name,
            templateId: dashboard.templateId,
            engagedAt,
          },
        ]
      : [];
  });

  return [...taskItems, ...canvasItems]
    .sort((a, b) => b.engagedAt - a.engagedAt)
    .slice(0, limit);
}
