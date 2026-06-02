import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitClient } from "./client";
import { WorktreeManager } from "./worktree";

async function initBareRemote(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "posthog-code-remote-"));
  const git = createGitClient(dir);
  await git.init(["--bare", "--initial-branch", "main"]);
  return dir;
}

async function initLocalClone(remoteDir: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "posthog-code-local-"));
  const git = createGitClient(dir);
  await git.clone(remoteDir, dir);
  await git.addConfig("user.name", "Test");
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("commit.gpgsign", "false");
  return dir;
}

async function commit(repoDir: string, file: string, content: string) {
  await writeFile(path.join(repoDir, file), content);
  const git = createGitClient(repoDir);
  await git.add([file]);
  await git.commit(`add ${file}`);
}

async function shaOfBranch(repoDir: string, ref: string): Promise<string> {
  const git = createGitClient(repoDir);
  return (await git.revparse([ref])).trim();
}

describe("WorktreeManager.createWorktree fetchBeforeCreate", () => {
  let remoteDir: string;
  let localDir: string;
  let worktreeBaseDir: string;

  beforeEach(async () => {
    remoteDir = await initBareRemote();

    // Seed the remote with an initial commit on `main` so other clones can
    // fetch a real tip.
    const seedDir = await mkdtemp(path.join(tmpdir(), "posthog-code-seed-"));
    const seedGit = createGitClient(seedDir);
    await seedGit.init(["--initial-branch", "main"]);
    await seedGit.addConfig("user.name", "Test");
    await seedGit.addConfig("user.email", "test@example.com");
    await seedGit.addConfig("commit.gpgsign", "false");
    await commit(seedDir, "initial.txt", "initial\n");
    await seedGit.addRemote("origin", remoteDir);
    await seedGit.push(["origin", "main"]);
    await rm(seedDir, { recursive: true, force: true });

    localDir = await initLocalClone(remoteDir);
    worktreeBaseDir = await mkdtemp(path.join(tmpdir(), "posthog-code-wts-"));
  });

  afterEach(async () => {
    for (const d of [remoteDir, localDir, worktreeBaseDir]) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "without fetchBeforeCreate, worktree is based on the stale local ref",
      fetchBeforeCreate: false,
      expectRemoteTip: false,
    },
    {
      name: "with fetchBeforeCreate, worktree starts at the remote tip",
      fetchBeforeCreate: true,
      expectRemoteTip: true,
    },
  ])("$name", async ({ fetchBeforeCreate, expectRemoteTip }) => {
    // Advance the remote: push a new commit from a separate clone.
    const otherDir = await initLocalClone(remoteDir);
    await commit(otherDir, "remote-new.txt", "remote-new\n");
    const otherGit = createGitClient(otherDir);
    await otherGit.push(["origin", "main"]);
    const remoteTip = await shaOfBranch(otherDir, "main");
    await rm(otherDir, { recursive: true, force: true });

    const localTipBefore = await shaOfBranch(localDir, "main");
    expect(localTipBefore).not.toBe(remoteTip);

    const manager = new WorktreeManager({
      mainRepoPath: localDir,
      worktreeBasePath: worktreeBaseDir,
    });
    const info = await manager.createWorktree({
      baseBranch: "main",
      fetchBeforeCreate,
    });

    const worktreeHead = await shaOfBranch(info.worktreePath, "HEAD");
    if (expectRemoteTip) {
      expect(worktreeHead).toBe(remoteTip);
    } else {
      expect(worktreeHead).toBe(localTipBefore);
      expect(worktreeHead).not.toBe(remoteTip);
    }

    // Local `main` should never be mutated — only `origin/main` advances on fetch.
    const localMainAfter = await shaOfBranch(localDir, "main");
    expect(localMainAfter).toBe(localTipBefore);
  });

  it("with fetchBeforeCreate and an unreachable remote, falls back to local base", async () => {
    // Point origin at a directory that doesn't exist so the fetch fails.
    const git = createGitClient(localDir);
    await git.remote(["set-url", "origin", "/nonexistent/path/to/remote"]);

    const localTipBefore = await shaOfBranch(localDir, "main");

    const manager = new WorktreeManager({
      mainRepoPath: localDir,
      worktreeBasePath: worktreeBaseDir,
    });
    const info = await manager.createWorktree({
      baseBranch: "main",
      fetchBeforeCreate: true,
    });

    const worktreeHead = await shaOfBranch(info.worktreePath, "HEAD");
    expect(worktreeHead).toBe(localTipBefore);
  });
});
