import type { HomeSnapshot, HomeWorkstream } from "@posthog/core/home/schemas";
import type { Task } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import { insertOptimisticTask, workstreamTaskFromTask } from "./optimisticTask";

function makeWs(overrides: Partial<HomeWorkstream> = {}): HomeWorkstream {
  return {
    id: "ws_1",
    repoName: null,
    repoFullPath: null,
    branch: null,
    prUrl: null,
    pr: null,
    tasks: [],
    situations: [],
    primarySituation: null,
    lastActivityAt: 0,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_1",
    task_number: 1,
    slug: "T-1",
    title: "Fix CI",
    description: "",
    created_at: "",
    updated_at: "",
    origin_product: "user_created",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<HomeSnapshot> = {}): HomeSnapshot {
  return { activeAgents: [], needsAttention: [], inProgress: [], ...overrides };
}

describe("workstreamTaskFromTask", () => {
  it("maps a created task to a provisional queued workstream task", () => {
    const wsTask = workstreamTaskFromTask(makeTask());
    expect(wsTask).toEqual({
      id: "task_1",
      title: "Fix CI",
      status: "queued",
      isGenerating: false,
      needsPermission: false,
      quickAction: null,
    });
  });

  it("records the quick action label when provided", () => {
    expect(workstreamTaskFromTask(makeTask(), "Fix CI").quickAction).toBe(
      "Fix CI",
    );
  });

  it("prefers the latest run status when present", () => {
    const wsTask = workstreamTaskFromTask(
      makeTask({ latest_run: { status: "in_progress" } as Task["latest_run"] }),
    );
    expect(wsTask.status).toBe("in_progress");
  });

  it("falls back to a placeholder title", () => {
    expect(workstreamTaskFromTask(makeTask({ title: "" })).title).toBe(
      "New task",
    );
  });
});

describe("insertOptimisticTask", () => {
  it("prepends the task to the matching workstream", () => {
    const snapshot = makeSnapshot({
      inProgress: [
        makeWs({
          id: "ws_1",
          tasks: [
            {
              id: "old",
              title: "Old",
              status: "completed",
              isGenerating: false,
              needsPermission: false,
            },
          ],
        }),
      ],
    });

    const next = insertOptimisticTask(snapshot, "ws_1", makeTask());

    expect(next.inProgress[0].tasks.map((t) => t.id)).toEqual([
      "task_1",
      "old",
    ]);
  });

  it("matches workstreams in either bucket", () => {
    const snapshot = makeSnapshot({
      needsAttention: [makeWs({ id: "ws_attn" })],
    });
    const next = insertOptimisticTask(snapshot, "ws_attn", makeTask());
    expect(next.needsAttention[0].tasks.map((t) => t.id)).toEqual(["task_1"]);
  });

  it("leaves other workstreams untouched", () => {
    const other = makeWs({ id: "ws_2" });
    const snapshot = makeSnapshot({
      inProgress: [makeWs({ id: "ws_1" }), other],
    });

    const next = insertOptimisticTask(snapshot, "ws_1", makeTask());

    expect(next.inProgress[1]).toBe(other);
    expect(next.inProgress[0].tasks.map((t) => t.id)).toEqual(["task_1"]);
  });

  it("tags the spliced task with the quick action label", () => {
    const snapshot = makeSnapshot({ inProgress: [makeWs({ id: "ws_1" })] });
    const next = insertOptimisticTask(snapshot, "ws_1", makeTask(), "Fix CI");
    expect(next.inProgress[0].tasks[0].quickAction).toBe("Fix CI");
  });

  it("does not duplicate a task that is already present", () => {
    const snapshot = makeSnapshot({
      inProgress: [
        makeWs({
          id: "ws_1",
          tasks: [
            {
              id: "task_1",
              title: "Fix CI",
              status: "queued",
              isGenerating: false,
              needsPermission: false,
            },
          ],
        }),
      ],
    });

    const next = insertOptimisticTask(snapshot, "ws_1", makeTask());

    expect(next.inProgress[0].tasks).toHaveLength(1);
  });
});
