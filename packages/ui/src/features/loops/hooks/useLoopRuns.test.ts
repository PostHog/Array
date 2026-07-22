import type { LoopSchemas } from "@posthog/api-client/loops";
import type { Task } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import { reconcileLoopRunStatus } from "./useLoopRuns";

const loopRun = {
  id: "loop-run-1",
  task_id: "task-1",
  loop_trigger_id: null,
  status: "in_progress",
  environment: "cloud",
  branch: null,
  error_message: null,
  output: null,
  created_at: "2026-07-22T12:00:00Z",
  completed_at: null,
} satisfies LoopSchemas.LoopRun;

function taskWithRun(
  status: "in_progress" | "completed" | "failed" | "cancelled",
): Task {
  return {
    id: "task-1",
    task_number: 1,
    slug: "loop-task",
    title: "Loop task",
    description: "",
    created_at: loopRun.created_at,
    updated_at: loopRun.created_at,
    origin_product: "user_created",
    latest_run: {
      id: "task-run-1",
      task: "task-1",
      team: 2,
      branch: null,
      environment: "cloud",
      status,
      log_url: "",
      error_message: status === "failed" ? "Run failed" : null,
      output: null,
      state: {},
      created_at: loopRun.created_at,
      updated_at: "2026-07-22T12:01:00Z",
      completed_at: "2026-07-22T12:01:00Z",
    },
  };
}

describe("reconcileLoopRunStatus", () => {
  it.each(["cancelled", "failed"] as const)(
    "uses the terminal task status when loop history is stale: %s",
    (status) => {
      expect(reconcileLoopRunStatus(loopRun, taskWithRun(status))).toEqual(
        expect.objectContaining({
          status,
          completed_at: "2026-07-22T12:01:00Z",
        }),
      );
    },
  );

  it.each(["in_progress", "completed"] as const)(
    "keeps loop history unchanged for task status: %s",
    (status) => {
      expect(reconcileLoopRunStatus(loopRun, taskWithRun(status))).toBe(
        loopRun,
      );
    },
  );
});
