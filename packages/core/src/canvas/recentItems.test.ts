import type { Task } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import type { DashboardSummary } from "./dashboardSchemas";
import { buildRecentItems } from "./recentItems";

describe("buildRecentItems", () => {
  it("returns the 20 most recently engaged tasks and canvases", () => {
    const tasks = Array.from({ length: 12 }, (_, index) => ({
      id: `task-${index}`,
      title: `Task ${index}`,
      updated_at: new Date(index * 1_000).toISOString(),
    })) as Task[];
    const dashboards = Array.from({ length: 12 }, (_, index) => ({
      id: `canvas-${index}`,
      channelId: "channel-1",
      name: `Canvas ${index}`,
      templateId: "freeform",
      updatedAt: (index + 12) * 1_000,
    })) as DashboardSummary[];

    const result = buildRecentItems({
      tasks,
      dashboards,
      taskTimestamps: Object.fromEntries(
        tasks.map((task, index) => [
          task.id,
          { lastViewedAt: index * 1_000, lastActivityAt: null },
        ]),
      ),
      canvasViewedAt: Object.fromEntries(
        dashboards.map((dashboard, index) => [
          dashboard.id,
          (index + 12) * 1_000,
        ]),
      ),
    });

    expect(result).toHaveLength(20);
    expect(result[0]).toMatchObject({ kind: "canvas", id: "canvas-11" });
    expect(result.at(-1)).toMatchObject({ kind: "task", id: "task-4" });
  });

  it("uses the latest view, activity, or update and excludes untouched tasks", () => {
    const tasks = [
      { id: "viewed", title: "Viewed", updated_at: "2020-01-01" },
      { id: "prompted", title: "Prompted", updated_at: "2020-01-01" },
      { id: "untouched", title: "Untouched", updated_at: "2026-01-01" },
    ] as Task[];

    expect(
      buildRecentItems({
        tasks,
        dashboards: [],
        taskTimestamps: {
          viewed: { lastViewedAt: 2_000, lastActivityAt: 1_000 },
          prompted: { lastViewedAt: 1_000, lastActivityAt: 3_000 },
        },
      }).map((item) => item.id),
    ).toEqual(["prompted", "viewed"]);
  });
});
