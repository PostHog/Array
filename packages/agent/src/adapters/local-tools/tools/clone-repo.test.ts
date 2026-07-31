import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloneRun: vi.fn(),
  getCurrentBranch: vi.fn(),
}));

vi.mock("@posthog/git/sagas/clone", () => ({
  CloneSaga: class {
    run = mocks.cloneRun;
  },
}));

vi.mock("@posthog/git/queries", () => ({
  getCurrentBranch: mocks.getCurrentBranch,
}));

vi.mock("../../../utils/github-token", () => ({
  resolveGithubToken: vi.fn(() => undefined),
}));

const { cloneRepoTool } = await import("./clone-repo");

describe("clone_repo", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "posthog-code-clone-tool-"));
    mocks.cloneRun.mockReset().mockResolvedValue({
      success: true,
      data: { targetPath: path.join(cwd, "repos", "PostHog", "posthog") },
    });
    mocks.getCurrentBranch.mockReset().mockResolvedValue("feature");
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("requests a shallow clone of the selected branch", async () => {
    const result = await cloneRepoTool.handler(
      { cwd, token: "test-token" },
      { repo: "PostHog/posthog", branch: "feature" },
    );

    expect(result.isError).toBeUndefined();
    expect(mocks.cloneRun).toHaveBeenCalledWith({
      repoUrl:
        "https://x-access-token:test-token@github.com/PostHog/posthog.git",
      targetPath: path.join(cwd, "repos", "PostHog", "posthog"),
      branch: "feature",
      shallow: true,
    });
  });
});
