import type { TaskData } from "@features/sidebar/hooks/useSidebarData";
import { describe, expect, it } from "vitest";
import { buildSnapshotFromTasks } from "./buildSnapshot";

const MINUTE = 60 * 1000;

function makeTask(overrides: Partial<TaskData> = {}): TaskData {
  return {
    id: "t1",
    title: "Task",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    isGenerating: false,
    isUnread: false,
    isPinned: false,
    needsPermission: false,
    repository: { fullPath: "org/repo", name: "repo" },
    isSuspended: false,
    taskRunStatus: "in_progress",
    folderPath: null,
    cloudPrUrl: null,
    branchName: "feature",
    linkedBranch: null,
    ...overrides,
  };
}

describe("buildSnapshotFromTasks — Running strip", () => {
  it("keeps a genuinely live in_progress agent in the Running strip", () => {
    const { activeAgents, inProgress, needsAttention } = buildSnapshotFromTasks(
      [],
      [makeTask({ lastActivityAt: Date.now() - MINUTE })],
    );

    expect(activeAgents).toHaveLength(1);
    expect(inProgress).toHaveLength(0);
    expect(needsAttention).toHaveLength(0);
  });

  it("drops an agent with an open PR out of Running and into review", () => {
    const { activeAgents, inProgress } = buildSnapshotFromTasks(
      [],
      [
        makeTask({
          cloudPrUrl: "https://github.com/org/repo/pull/1",
          lastActivityAt: Date.now(),
        }),
      ],
    );

    expect(activeAgents).toHaveLength(0);
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0]?.situations).toContain("in_review");
  });

  it("drops a stale in_progress agent out of the Running strip", () => {
    const { activeAgents, inProgress, needsAttention } = buildSnapshotFromTasks(
      [],
      [makeTask({ lastActivityAt: Date.now() - 45 * MINUTE })],
    );

    expect(activeAgents).toHaveLength(0);
    // Branch with no PR + recent-enough to not be 7-day stale → "Working".
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0]?.situations).toContain("working");
    expect(needsAttention).toHaveLength(0);
  });

  it("keeps a stale-by-timestamp agent in Running while it awaits permission", () => {
    const { activeAgents } = buildSnapshotFromTasks(
      [],
      [
        makeTask({
          needsPermission: true,
          lastActivityAt: Date.now() - 45 * MINUTE,
        }),
      ],
    );

    expect(activeAgents).toHaveLength(1);
  });

  it("keeps a stale-by-timestamp agent in Running while it is generating", () => {
    const { activeAgents } = buildSnapshotFromTasks(
      [],
      [
        makeTask({
          isGenerating: true,
          lastActivityAt: Date.now() - 45 * MINUTE,
        }),
      ],
    );

    expect(activeAgents).toHaveLength(1);
  });
});
