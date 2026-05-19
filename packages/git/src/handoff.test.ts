import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { createGitClient } from "./client";
import {
  type GitHandoffApplyInput,
  type GitHandoffCaptureResult,
  GitHandoffTracker,
  type HandoffLocalGitState,
} from "./handoff";

const execFileAsync = promisify(execFile);

async function setupRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "posthog-code-handoff-"));
  const git = createGitClient(dir);
  await git.init();
  await git.addConfig("user.name", "PostHog Code Test");
  await git.addConfig("user.email", "posthog-code-test@example.com");
  await git.addConfig("commit.gpgsign", "false");

  await writeFile(path.join(dir, "tracked.txt"), "base\n");
  await writeFile(path.join(dir, "unstaged.txt"), "base unstaged\n");
  await git.add(["tracked.txt", "unstaged.txt"]);
  await git.commit("initial");

  return dir;
}

async function cloneRepo(sourcePath: string): Promise<string> {
  const clonePath = await mkdtemp(
    path.join(tmpdir(), "posthog-code-handoff-clone-"),
  );
  await execFileAsync("git", ["clone", sourcePath, clonePath]);
  await execFileAsync("git", ["config", "user.email", "test@test.com"], {
    cwd: clonePath,
  });
  await execFileAsync("git", ["config", "user.name", "Test"], {
    cwd: clonePath,
  });
  await execFileAsync("git", ["config", "commit.gpgsign", "false"], {
    cwd: clonePath,
  });
  return clonePath;
}

interface RepoHarness {
  cloudRepo: string;
  localRepo: string;
  branch: string;
  cloudGit: ReturnType<typeof createGitClient>;
  localGit: ReturnType<typeof createGitClient>;
  localGitState: HandoffLocalGitState;
}

async function withRepos<T>(
  fn: (repos: RepoHarness) => Promise<T>,
): Promise<T> {
  const cloudRepo = await setupRepo();
  const localRepo = await cloneRepo(cloudRepo);
  const cloudGit = createGitClient(cloudRepo);
  const localGit = createGitClient(localRepo);
  try {
    const branch = (await cloudGit.revparse(["--abbrev-ref", "HEAD"])).trim();
    const localHead = (await localGit.revparse(["HEAD"])).trim();
    const upstreamHead = (await localGit.revparse([`origin/${branch}`])).trim();

    return await fn({
      cloudRepo,
      localRepo,
      branch,
      cloudGit,
      localGit,
      localGitState: {
        head: localHead,
        branch,
        upstreamHead,
        upstreamRemote: "origin",
        upstreamMergeRef: `refs/heads/${branch}`,
      },
    });
  } finally {
    await rm(localRepo, { recursive: true, force: true });
    await rm(cloudRepo, { recursive: true, force: true });
  }
}

async function makeCloudChanges(
  cloudRepo: string,
  cloudGit: ReturnType<typeof createGitClient>,
) {
  await writeFile(path.join(cloudRepo, "committed.txt"), "cloud commit\n");
  await cloudGit.add(["committed.txt"]);
  await cloudGit.commit("Cloud commit");

  await writeFile(path.join(cloudRepo, "tracked.txt"), "staged change\n");
  await cloudGit.add(["tracked.txt"]);
  await writeFile(path.join(cloudRepo, "unstaged.txt"), "unstaged change\n");
  await writeFile(path.join(cloudRepo, "untracked.txt"), "untracked\n");
}

async function cleanupCapture(capture: GitHandoffCaptureResult): Promise<void> {
  if (capture.headPack?.path) {
    await rm(capture.headPack.path, { force: true }).catch(() => {});
  }
  await rm(capture.indexFile.path, { force: true }).catch(() => {});
}

async function captureAndApply(
  repos: RepoHarness,
  options?: {
    captureState?: HandoffLocalGitState;
    applyState?: HandoffLocalGitState;
    onDivergedBranch?: GitHandoffApplyInput["onDivergedBranch"];
  },
): Promise<GitHandoffCaptureResult> {
  const captureTracker = new GitHandoffTracker({
    repositoryPath: repos.cloudRepo,
  });
  const capture = await captureTracker.captureForHandoff(
    options?.captureState ?? repos.localGitState,
  );

  const applyTracker = new GitHandoffTracker({
    repositoryPath: repos.localRepo,
  });

  try {
    await applyTracker.applyFromHandoff({
      checkpoint: capture.checkpoint,
      headPackPath: capture.headPack?.path,
      indexPath: capture.indexFile.path,
      localGitState: options?.applyState ?? repos.localGitState,
      onDivergedBranch: options?.onDivergedBranch,
    });
  } catch (error) {
    await cleanupCapture(capture);
    throw error;
  }

  return capture;
}

describe("GitHandoffTracker", () => {
  it("captures and reapplies head, worktree, and index state from local files", async () => {
    await withRepos(async (repos) => {
      await makeCloudChanges(repos.cloudRepo, repos.cloudGit);
      const capture = await captureAndApply(repos);

      try {
        expect((await repos.localGit.revparse(["HEAD"])).trim()).toBe(
          capture.checkpoint.head,
        );
        expect(
          (await repos.localGit.revparse(["--abbrev-ref", "HEAD"])).trim(),
        ).toBe(repos.branch);
        expect(
          await readFile(path.join(repos.localRepo, "committed.txt"), "utf-8"),
        ).toBe("cloud commit\n");
        expect(
          await readFile(path.join(repos.localRepo, "tracked.txt"), "utf-8"),
        ).toBe("staged change\n");
        expect(
          await readFile(path.join(repos.localRepo, "unstaged.txt"), "utf-8"),
        ).toBe("unstaged change\n");
        expect(
          await readFile(path.join(repos.localRepo, "untracked.txt"), "utf-8"),
        ).toBe("untracked\n");

        const status = await repos.localGit.raw(["status", "--porcelain"]);
        expect(status).toContain("M  tracked.txt");
        expect(status).toContain(" M unstaged.txt");
        expect(status).toContain("?? untracked.txt");
      } finally {
        await cleanupCapture(capture);
      }
    });
  }, 15000);

  it("keeps shipped index consistent with worktreeTree for staged large files", async () => {
    await withRepos(async (repos) => {
      const largePath = path.join(repos.cloudRepo, "tracked.txt");
      const modified = Buffer.alloc(1024 * 1024 + 1, 9);
      await writeFile(largePath, modified);
      await repos.cloudGit.add(["tracked.txt"]);

      const capture = await captureAndApply(repos);

      try {
        const restored = await readFile(
          path.join(repos.localRepo, "tracked.txt"),
          "utf-8",
        );
        expect(restored).toBe("base\n");

        const status = await repos.localGit.raw(["status", "--porcelain"]);
        expect(status).not.toMatch(/^M[ M] tracked\.txt/m);
        expect(status).not.toMatch(/^MM tracked\.txt/m);
      } finally {
        await cleanupCapture(capture);
      }
    });
  }, 20000);

  it("removes tracked files absent from the checkpoint worktree", async () => {
    await withRepos(async (repos) => {
      await rm(path.join(repos.cloudRepo, "tracked.txt"));
      await repos.cloudGit.raw(["rm", "--cached", "tracked.txt"]);
      await repos.cloudGit.commit("Remove tracked file");

      const capture = await captureAndApply(repos);

      try {
        await expect(
          readFile(path.join(repos.localRepo, "tracked.txt"), "utf-8"),
        ).rejects.toThrow();

        const status = await repos.localGit.raw(["status", "--porcelain"]);
        expect(status).not.toContain("tracked.txt");
      } finally {
        await cleanupCapture(capture);
      }
    });
  }, 15000);

  it("prompts before resetting a diverged local branch", async () => {
    await withRepos(async (repos) => {
      await writeFile(
        path.join(repos.localRepo, "local-only.txt"),
        "local commit\n",
      );
      await repos.localGit.add(["local-only.txt"]);
      await repos.localGit.commit("Local only");
      const localHead = (await repos.localGit.revparse(["HEAD"])).trim();

      await writeFile(
        path.join(repos.cloudRepo, "cloud-only.txt"),
        "cloud commit\n",
      );
      await repos.cloudGit.add(["cloud-only.txt"]);
      await repos.cloudGit.commit("Cloud only");

      const captureTracker = new GitHandoffTracker({
        repositoryPath: repos.cloudRepo,
      });
      const capture = await captureTracker.captureForHandoff({
        ...repos.localGitState,
        head: localHead,
        upstreamHead: null,
      });

      const confirm = vi.fn().mockResolvedValue(false);
      const applyTracker = new GitHandoffTracker({
        repositoryPath: repos.localRepo,
      });

      try {
        await expect(
          applyTracker.applyFromHandoff({
            checkpoint: capture.checkpoint,
            headPackPath: capture.headPack?.path,
            indexPath: capture.indexFile.path,
            localGitState: {
              ...repos.localGitState,
              head: localHead,
              upstreamHead: null,
            },
            onDivergedBranch: confirm,
          }),
        ).rejects.toThrow("Handoff aborted");

        expect(confirm).toHaveBeenCalledWith(
          expect.objectContaining({
            branch: repos.branch,
            cloudHead: capture.checkpoint.head,
          }),
        );
        expect(
          (
            await repos.localGit.revparse([`refs/heads/${repos.branch}`])
          ).trim(),
        ).not.toBe(capture.checkpoint.head);
      } finally {
        await cleanupCapture(capture);
      }
    });
  }, 15000);

  it("preserves existing local upstream config", async () => {
    await withRepos(async (repos) => {
      await repos.localGit.raw([
        "remote",
        "set-url",
        "origin",
        "git@github.com:local/repo.git",
      ]);
      await repos.localGit.raw([
        "config",
        `branch.${repos.branch}.remote`,
        "origin",
      ]);
      await repos.localGit.raw([
        "config",
        `branch.${repos.branch}.merge`,
        `refs/heads/${repos.branch}`,
      ]);

      await repos.cloudGit.addRemote(
        "cloud-origin",
        "https://example.com/cloud.git",
      );
      await repos.cloudGit.raw([
        "config",
        `branch.${repos.branch}.remote`,
        "cloud-origin",
      ]);
      await repos.cloudGit.raw([
        "config",
        `branch.${repos.branch}.merge`,
        `refs/heads/${repos.branch}`,
      ]);

      await writeFile(
        path.join(repos.cloudRepo, "cloud-only.txt"),
        "cloud commit\n",
      );
      await repos.cloudGit.add(["cloud-only.txt"]);
      await repos.cloudGit.commit("Cloud only");

      const capture = await captureAndApply(repos, {
        captureState: {
          ...repos.localGitState,
          upstreamHead: null,
        },
      });

      try {
        expect(
          (
            await repos.localGit.raw([
              "config",
              "--get",
              `branch.${repos.branch}.remote`,
            ])
          ).trim(),
        ).toBe("origin");
        expect(
          (await repos.localGit.raw(["remote", "get-url", "origin"])).trim(),
        ).toBe("git@github.com:local/repo.git");
      } finally {
        await cleanupCapture(capture);
      }
    });
  }, 15000);

  it("adopts cloud upstream when the local branch has none", async () => {
    await withRepos(async (repos) => {
      await repos.localGit
        .raw(["config", "--unset-all", `branch.${repos.branch}.remote`])
        .catch(() => {});
      await repos.localGit
        .raw(["config", "--unset-all", `branch.${repos.branch}.merge`])
        .catch(() => {});
      await repos.localGit.removeRemote("origin");

      await repos.cloudGit.addRemote(
        "cloud-origin",
        "https://example.com/cloud.git",
      );
      await repos.cloudGit.raw([
        "config",
        `branch.${repos.branch}.remote`,
        "cloud-origin",
      ]);
      await repos.cloudGit.raw([
        "config",
        `branch.${repos.branch}.merge`,
        `refs/heads/${repos.branch}`,
      ]);

      await writeFile(
        path.join(repos.cloudRepo, "cloud-only.txt"),
        "cloud commit\n",
      );
      await repos.cloudGit.add(["cloud-only.txt"]);
      await repos.cloudGit.commit("Cloud only");

      const capture = await captureAndApply(repos, {
        captureState: {
          ...repos.localGitState,
          upstreamHead: null,
          upstreamRemote: null,
          upstreamMergeRef: null,
        },
        applyState: {
          ...repos.localGitState,
          upstreamRemote: null,
          upstreamMergeRef: null,
        },
      });

      try {
        expect(
          (
            await repos.localGit.raw([
              "config",
              "--get",
              `branch.${repos.branch}.remote`,
            ])
          ).trim(),
        ).toBe("cloud-origin");
        expect(
          (
            await repos.localGit.raw(["remote", "get-url", "cloud-origin"])
          ).trim(),
        ).toBe("https://example.com/cloud.git");
      } finally {
        await cleanupCapture(capture);
      }
    });
  }, 15000);
});
