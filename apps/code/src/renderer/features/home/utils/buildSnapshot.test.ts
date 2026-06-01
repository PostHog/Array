import type { TaskData } from "@features/sidebar/hooks/useSidebarData";
import type { PrSnapshot } from "@shared/types/pr-snapshot";
import { describe, expect, it } from "vitest";
import { buildSnapshotFromTasks } from "./buildSnapshot";

const MINUTE = 60 * 1000;

function makePr(overrides: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    url: "https://github.com/org/repo/pull/7",
    number: 7,
    title: "PR",
    state: "open",
    ciStatus: "passing",
    reviewDecision: null,
    unresolvedThreads: 0,
    mergeable: null,
    isCurrentUserRequestedReviewer: false,
    isCurrentUserAuthor: true,
    author: "me",
    lastUpdatedAt: Date.now(),
    ...overrides,
  };
}

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

describe("buildSnapshotFromTasks — resolved PR snapshots (branch PRs)", () => {
  it("surfaces a branch PR with failing CI under Needs attention", () => {
    const task = makeTask({
      id: "t-ci",
      taskRunStatus: "completed",
      cloudPrUrl: null, // PR lives on the branch, not cloud-run output
      linkedBranch: "feature",
    });
    const prByTaskId = new Map([
      [task.id, makePr({ ciStatus: "failing", state: "open" })],
    ]);

    const { needsAttention, inProgress, activeAgents } = buildSnapshotFromTasks(
      [],
      [task],
      prByTaskId,
    );

    expect(activeAgents).toHaveLength(0);
    expect(needsAttention).toHaveLength(1);
    expect(needsAttention[0]?.situations).toContain("ci_failing");
    expect(needsAttention[0]?.prUrl).toBe("https://github.com/org/repo/pull/7");
    expect(needsAttention[0]?.pr?.ciStatus).toBe("failing");
    expect(inProgress).toHaveLength(0);
  });

  it("groups a task under its resolved PR even without a cloud PR URL", () => {
    const task = makeTask({
      id: "t-rev",
      taskRunStatus: "completed",
      cloudPrUrl: null,
    });
    const prByTaskId = new Map([[task.id, makePr({ state: "open" })]]);

    const { inProgress } = buildSnapshotFromTasks([], [task], prByTaskId);

    expect(inProgress).toHaveLength(1);
    expect(inProgress[0]?.situations).toContain("in_review");
  });

  it("drops an in_progress agent with a resolved branch PR out of Running", () => {
    const task = makeTask({ cloudPrUrl: null, lastActivityAt: Date.now() });
    const prByTaskId = new Map([[task.id, makePr({ state: "open" })]]);

    const { activeAgents, inProgress } = buildSnapshotFromTasks(
      [],
      [task],
      prByTaskId,
    );

    expect(activeAgents).toHaveLength(0);
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0]?.situations).toContain("in_review");
  });
});
