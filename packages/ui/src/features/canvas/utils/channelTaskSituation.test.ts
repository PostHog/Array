import type { Task } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import { fallbackChannelTaskSituation } from "./channelTaskSituation";

function task(latestRun?: Task["latest_run"]): Task {
  return {
    id: "task-1",
    task_number: 1,
    slug: "task-1",
    title: "Task",
    description: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    origin_product: "user_created",
    latest_run: latestRun,
  };
}

describe("fallbackChannelTaskSituation", () => {
  it.each([
    [undefined, "working"],
    ["not_started", "working"],
    ["queued", "working"],
    ["in_progress", "working"],
    ["completed", "in_review"],
    ["failed", null],
    ["cancelled", null],
  ] as const)("maps %s to %s", (status, expected) => {
    const latestRun = status
      ? ({ status, output: null } as unknown as Task["latest_run"])
      : undefined;
    expect(fallbackChannelTaskSituation(task(latestRun))).toBe(expected);
  });

  it("places a task with an attached PR in review", () => {
    expect(
      fallbackChannelTaskSituation(
        task({
          status: "in_progress",
          output: { pr_url: "https://pr" },
        } as unknown as Task["latest_run"]),
      ),
    ).toBe("in_review");
  });
});
