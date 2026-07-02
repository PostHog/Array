import { describe, expect, it, vi } from "vitest";
import type { WatcherEvent } from "./schemas";
import { WatcherService } from "./service";

/**
 * Records every `watch()` call so we can assert what each watched directory is
 * told to ignore, then drains the generator so the loops shut down cleanly.
 */
async function collectWatchCalls(
  repoPath: string,
  gitDirs: {
    gitDir: string | null;
    commonDir: string | null;
  },
): Promise<Array<{ dir: string; ignore?: string[] }>> {
  const service = new WatcherService();
  const calls: Array<{ dir: string; ignore?: string[] }> = [];

  vi.spyOn(service, "resolveGitDirs").mockResolvedValue(gitDirs);
  // Empty generators end the file/git loops immediately, so watchRepo settles
  // after recording the subscribe targets.
  vi.spyOn(service, "watch").mockImplementation(
    // biome-ignore lint/correctness/useYield: intentionally empty generator
    async function* (
      dir: string,
      options: { ignore?: string[] },
    ): AsyncGenerator<WatcherEvent[]> {
      calls.push({ dir, ignore: options.ignore });
    },
  );

  const controller = new AbortController();
  const gen = service.watchRepo(repoPath, controller.signal);
  await gen.next();
  controller.abort();
  await gen.return?.(undefined);

  return calls;
}

describe("WatcherService.watchRepo ignore patterns", () => {
  it("excludes the cross-worktree admin subtree from the linked worktree's git watches", async () => {
    const repoPath = "/repo/.worktrees/feature/myrepo";
    const calls = await collectWatchCalls(repoPath, {
      gitDir: "/main/.git/worktrees/feature",
      commonDir: "/main/.git",
    });

    // The shared commondir is watched but must skip `.git/worktrees/**`, so a
    // sibling worktree's HEAD/index churn (e.g. creating a new worktree) no
    // longer wakes this worktree's watcher.
    const commonDirCall = calls.find((c) => c.dir === "/main/.git");
    expect(commonDirCall?.ignore).toEqual(["**/worktrees/**"]);

    // The worktree's own gitDir is rooted inside `worktrees/<name>`, where the
    // pattern matches nothing, so its own HEAD changes are still observed.
    const gitDirCall = calls.find(
      (c) => c.dir === "/main/.git/worktrees/feature",
    );
    expect(gitDirCall?.ignore).toEqual(["**/worktrees/**"]);

    // The working tree keeps its own ignores (node_modules/.git/.jj).
    const workingTreeCall = calls.find((c) => c.dir === repoPath);
    expect(workingTreeCall?.ignore).toContain("**/node_modules/**");
    expect(workingTreeCall?.ignore).not.toContain("**/worktrees/**");
  });

  it("watches a non-worktree repo's git dir once with the worktrees ignore", async () => {
    const repoPath = "/main";
    const calls = await collectWatchCalls(repoPath, {
      gitDir: "/main/.git",
      commonDir: null,
    });

    const gitDirCalls = calls.filter((c) => c.dir === "/main/.git");
    expect(gitDirCalls).toHaveLength(1);
    expect(gitDirCalls[0]?.ignore).toEqual(["**/worktrees/**"]);
  });
});
