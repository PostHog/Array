import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createGitClient } from "@posthog/git/client";
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

  it("fetches a missing branch into an existing shallow clone", async () => {
    const sourcePath = path.join(cwd, "source");
    const targetPath = path.join(cwd, "repos", "PostHog", "posthog");
    await mkdir(sourcePath, { recursive: true });
    await createGitClient().raw([
      "init",
      "--initial-branch=master",
      sourcePath,
    ]);

    const sourceGit = createGitClient(sourcePath);
    await sourceGit.addConfig("user.name", "PostHog Code test");
    await sourceGit.addConfig("user.email", "test@posthog.com");
    await writeFile(path.join(sourcePath, "README.md"), "master\n");
    await sourceGit.add("README.md");
    await sourceGit.commit("initial commit");
    await sourceGit.checkoutLocalBranch("feature");
    await writeFile(path.join(sourcePath, "README.md"), "feature\n");
    await sourceGit.add("README.md");
    await sourceGit.commit("feature commit");
    await sourceGit.checkout("master");

    await mkdir(path.dirname(targetPath), { recursive: true });
    await createGitClient().clone(pathToFileURL(sourcePath).href, targetPath, [
      "--depth",
      "1",
      "--single-branch",
      "--no-tags",
      "--branch",
      "master",
    ]);

    const result = await cloneRepoTool.handler(
      { cwd, token: "test-token" },
      { repo: "PostHog/posthog", branch: "feature" },
    );

    expect(result.isError).toBeUndefined();
    const targetGit = createGitClient(targetPath);
    expect((await targetGit.branchLocal()).current).toBe("feature");
    expect(
      await targetGit.raw([
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ]),
    ).toBe("origin/feature");
    expect(await targetGit.raw(["rev-parse", "--is-shallow-repository"])).toBe(
      "true",
    );
    expect(await targetGit.raw(["rev-list", "--count", "HEAD"])).toBe("1");
  });
});
