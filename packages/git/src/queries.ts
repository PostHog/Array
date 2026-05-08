import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CreateGitClientOptions } from "./client";
import { getGitOperationManager } from "./operation-manager";

export interface WorktreeListEntry {
  path: string;
  head: string;
  branch: string | null;
}

export interface AheadBehind {
  aheadOfRemote: number;
  behind: number;
}

export interface GitStatus {
  isClean: boolean;
  staged: string[];
  modified: string[];
  deleted: string[];
  untracked: string[];
}

type GitLike = {
  raw: (args: string[]) => Promise<string>;
  revparse: (args: string[]) => Promise<string>;
};

export async function detectDefaultBranch(git: GitLike): Promise<string> {
  try {
    const remoteBranch = await git.raw([
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
    ]);
    return remoteBranch.trim().replace("refs/remotes/origin/", "");
  } catch {
    // Check common default branch names
    for (const candidate of ["main", "master"]) {
      try {
        await git.revparse(["--verify", candidate]);
        return candidate;
      } catch {}
    }

    // Check git config init.defaultBranch (user's configured default)
    try {
      const configured = await git.raw(["config", "init.defaultBranch"]);
      const branch = configured.trim();
      if (branch) {
        try {
          await git.revparse(["--verify", branch]);
          return branch;
        } catch {}
      }
    } catch {}

    // Fall back to current branch (HEAD)
    try {
      const head = await git.raw(["rev-parse", "--abbrev-ref", "HEAD"]);
      const branch = head.trim();
      if (branch && branch !== "HEAD") {
        return branch;
      }
    } catch {}

    throw new Error("Cannot determine default branch");
  }
}

async function detectDefaultBranchWithFallback(git: GitLike): Promise<string> {
  try {
    return await detectDefaultBranch(git);
  } catch {
    // Last resort: use current branch or "main"
    try {
      const head = await git.raw(["rev-parse", "--abbrev-ref", "HEAD"]);
      const branch = head.trim();
      if (branch && branch !== "HEAD") {
        return branch;
      }
    } catch {}
    return "main";
  }
}

export async function getCurrentBranch(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<string | null> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
      return branch === "HEAD" ? null : branch;
    },
    { signal: options?.abortSignal },
  );
}

export async function getDefaultBranch(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<string> {
  const manager = getGitOperationManager();
  return manager.executeRead(baseDir, detectDefaultBranch, {
    signal: options?.abortSignal,
  });
}

export async function getRemoteUrl(
  baseDir: string,
  remote = "origin",
  options?: CreateGitClientOptions,
): Promise<string | null> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      try {
        const url = await git.remote(["get-url", remote]);
        return url || null;
      } catch {
        if (remote === "origin") {
          const remotes = await git.getRemotes(true);
          if (remotes.length > 0 && remotes[0].refs.fetch) {
            return remotes[0].refs.fetch;
          }
        }
        return null;
      }
    },
    { signal: options?.abortSignal },
  );
}

export async function getStatus(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<GitStatus> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      const status = await git.status(["--untracked-files=all"]);
      return {
        isClean: status.isClean(),
        staged: status.staged,
        modified: status.modified,
        deleted: status.deleted,
        untracked: status.not_added,
      };
    },
    { signal: options?.abortSignal },
  );
}

export async function hasChanges(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<boolean> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      const status = await git.status(["--untracked-files=normal"]);
      return !status.isClean();
    },
    { signal: options?.abortSignal },
  );
}

export async function getAheadBehind(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<AheadBehind | null> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      const branchOutput = await git.revparse(["--abbrev-ref", "HEAD"]);
      const branch = branchOutput === "HEAD" ? null : branchOutput;
      if (!branch) return null;

      try {
        await git.raw(["rev-parse", "--abbrev-ref", `${branch}@{upstream}`]);
      } catch {
        return null;
      }

      const status = await git.status(["--untracked-files=no"]);
      return {
        aheadOfRemote: status.ahead,
        behind: status.behind,
      };
    },
    { signal: options?.abortSignal },
  );
}

export async function branchExists(
  baseDir: string,
  branchName: string,
  options?: CreateGitClientOptions,
): Promise<boolean> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      try {
        await git.revparse(["--verify", branchName]);
        return true;
      } catch {
        return false;
      }
    },
    { signal: options?.abortSignal },
  );
}

export async function listWorktrees(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<WorktreeListEntry[]> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      const output = await git.raw(["worktree", "list", "--porcelain"]);
      const worktrees: WorktreeListEntry[] = [];
      let current: Partial<WorktreeListEntry> = {};

      for (const line of output.split("\n")) {
        if (line.startsWith("worktree ")) {
          if (current.path) {
            worktrees.push(current as WorktreeListEntry);
          }
          current = { path: line.slice(9), branch: null };
        } else if (line.startsWith("HEAD ")) {
          current.head = line.slice(5);
        } else if (line.startsWith("branch ")) {
          current.branch = line.slice(7).replace("refs/heads/", "");
        } else if (line === "detached") {
          current.branch = null;
        }
      }

      if (current.path) {
        worktrees.push(current as WorktreeListEntry);
      }

      return worktrees;
    },
    { signal: options?.abortSignal },
  );
}

export async function getFileAtHead(
  baseDir: string,
  filePath: string,
  options?: CreateGitClientOptions,
): Promise<string | null> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      try {
        return await git.show([`HEAD:${filePath}`]);
      } catch {
        return null;
      }
    },
    { signal: options?.abortSignal },
  );
}

export async function getHeadSha(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<string> {
  const manager = getGitOperationManager();
  return manager.executeRead(baseDir, (git) => git.revparse(["HEAD"]), {
    signal: options?.abortSignal,
  });
}

export async function isDetachedHead(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<boolean> {
  const branch = await getCurrentBranch(baseDir, options);
  return branch === null;
}

export async function isGitRepository(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<boolean> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      try {
        await git.revparse(["--is-inside-work-tree"]);
        return true;
      } catch {
        return false;
      }
    },
    { signal: options?.abortSignal },
  );
}

export async function getChangedFiles(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<Set<string>> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      const changedFiles = new Set<string>();

      try {
        const defaultBranch = await detectDefaultBranchWithFallback(git);
        const branchOutput = await git.revparse(["--abbrev-ref", "HEAD"]);
        const currentBranch = branchOutput === "HEAD" ? null : branchOutput;

        if (currentBranch && currentBranch !== defaultBranch) {
          try {
            const diffOutput = await git.diff([
              "--name-only",
              `${defaultBranch}...HEAD`,
            ]);
            for (const file of diffOutput.split("\n").filter(Boolean)) {
              changedFiles.add(file);
            }
          } catch {}
        }

        const status = await git.status(["--untracked-files=all"]);
        for (const file of [
          ...status.modified,
          ...status.created,
          ...status.deleted,
          ...status.renamed.map((r) => r.to),
          ...status.not_added,
        ]) {
          changedFiles.add(file);
        }
      } catch {}

      return changedFiles;
    },
    { signal: options?.abortSignal },
  );
}

export async function getAllBranches(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<string[]> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      try {
        const summary = await git.branchLocal();
        return summary.all;
      } catch {
        return [];
      }
    },
    { signal: options?.abortSignal },
  );
}

export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked";

export interface ChangedFileInfo {
  path: string;
  status: GitFileStatus;
  originalPath?: string;
  linesAdded?: number;
  linesRemoved?: number;
  staged?: boolean;
}

export interface GetChangedFilesDetailedOptions extends CreateGitClientOptions {
  excludePatterns?: string[];
}

function matchesExcludePattern(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.startsWith("/")) {
      return (
        filePath === pattern.slice(1) ||
        filePath.startsWith(`${pattern.slice(1)}/`)
      );
    }
    return filePath === pattern || filePath.startsWith(`${pattern}/`);
  });
}

async function countFileLines(filePath: string): Promise<number> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    if (!content) return 0;
    return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  } catch {
    return 0;
  }
}

export async function getChangedFilesDetailed(
  baseDir: string,
  options?: GetChangedFilesDetailedOptions,
): Promise<ChangedFileInfo[]> {
  const { excludePatterns, ...gitOptions } = options ?? {};
  const manager = getGitOperationManager();

  return manager.executeRead(
    baseDir,
    async (git) => {
      try {
        const [stagedSummary, unstagedSummary, status] = await Promise.all([
          git.diffSummary(["--cached", "-M", "HEAD"]),
          git.diffSummary(["-M"]),
          git.status(["--untracked-files=all"]),
        ]);

        const diffSeenPaths = new Set<string>();
        const excludedPaths = new Set<string>();
        const files: ChangedFileInfo[] = [];

        const pushDiffFile = (
          file: (typeof stagedSummary.files)[number],
          staged: boolean,
        ) => {
          if (
            excludePatterns &&
            matchesExcludePattern(file.file, excludePatterns)
          ) {
            excludedPaths.add(file.file);
            return;
          }
          const hasFrom = "from" in file && file.from;
          const isBinary = file.binary;
          files.push({
            path: file.file,
            status: hasFrom
              ? "renamed"
              : status.deleted.includes(file.file)
                ? "deleted"
                : status.created.includes(file.file)
                  ? "added"
                  : "modified",
            originalPath: hasFrom ? (file.from as string) : undefined,
            linesAdded: isBinary
              ? undefined
              : (file as { insertions: number }).insertions,
            linesRemoved: isBinary
              ? undefined
              : (file as { deletions: number }).deletions,
            staged,
          });
          diffSeenPaths.add(file.file);
          if (hasFrom) diffSeenPaths.add(file.from as string);
        };

        for (const file of stagedSummary.files) {
          pushDiffFile(file, true);
        }
        for (const file of unstagedSummary.files) {
          pushDiffFile(file, false);
        }

        const MAX_UNTRACKED_FILES = 10_000;
        let untrackedProcessed = 0;
        for (const file of status.not_added) {
          if (untrackedProcessed >= MAX_UNTRACKED_FILES) break;
          if (diffSeenPaths.has(file) || excludedPaths.has(file)) continue;
          if (excludePatterns && matchesExcludePattern(file, excludePatterns)) {
            continue;
          }
          const lineCount = await countFileLines(path.join(baseDir, file));
          files.push({
            path: file,
            status: "untracked",
            linesAdded: lineCount,
            linesRemoved: 0,
          });
          untrackedProcessed++;
        }

        return files;
      } catch {
        return [];
      }
    },
    { signal: gitOptions?.abortSignal },
  );
}

export async function getChangedFilesBetweenBranches(
  baseDir: string,
  baseBranch: string,
  headBranch?: string,
  options?: GetChangedFilesDetailedOptions,
): Promise<ChangedFileInfo[]> {
  const { excludePatterns, ...gitOptions } = options ?? {};
  const manager = getGitOperationManager();

  return manager.executeRead(
    baseDir,
    async (git) => {
      try {
        const from = `origin/${baseBranch}`;
        const to = headBranch ?? "HEAD";

        const [diffSummary, nameStatusOutput] = await Promise.all([
          git.diffSummary(["-M", `${from}...${to}`]),
          git.raw(["diff", "--name-status", "-M", `${from}...${to}`]),
        ]);

        const statusMap = new Map<string, GitFileStatus>();
        for (const line of nameStatusOutput.split("\n").filter(Boolean)) {
          const parts = line.split("\t");
          const code = parts[0];
          const filePath = parts.length === 3 ? parts[2] : parts[1];
          if (!filePath) continue;

          if (code?.startsWith("R")) {
            statusMap.set(filePath, "renamed");
          } else if (code === "A") {
            statusMap.set(filePath, "added");
          } else if (code === "D") {
            statusMap.set(filePath, "deleted");
          } else {
            statusMap.set(filePath, "modified");
          }
        }

        const files: ChangedFileInfo[] = [];
        for (const file of diffSummary.files) {
          if (
            excludePatterns &&
            matchesExcludePattern(file.file, excludePatterns)
          ) {
            continue;
          }

          const hasFrom = "from" in file && file.from;
          const isBinary = file.binary;

          files.push({
            path: file.file,
            status: statusMap.get(file.file) ?? "modified",
            originalPath: hasFrom ? (file.from as string) : undefined,
            linesAdded: isBinary
              ? undefined
              : (file as { insertions: number }).insertions,
            linesRemoved: isBinary
              ? undefined
              : (file as { deletions: number }).deletions,
          });
        }

        return files;
      } catch {
        return [];
      }
    },
    { signal: gitOptions?.abortSignal },
  );
}

/**
 * Splits a unified `git diff` string into per-file patches, keyed by the `b/`
 * (post-rename) path, which is the shape `ChangedFileInfo.path` uses. Each
 * returned patch string begins with its own `diff --git ...` header and is a
 * valid standalone unified diff.
 */
export function splitUnifiedDiffByFile(raw: string): Map<string, string> {
  const patches = new Map<string, string>();
  if (!raw) return patches;

  const headerRegex = /^diff --git a\/.+? b\/(.+)$/gm;
  const matches: Array<{ path: string; start: number }> = [];
  let match = headerRegex.exec(raw);
  while (match !== null) {
    matches.push({ path: match[1], start: match.index });
    match = headerRegex.exec(raw);
  }

  for (let i = 0; i < matches.length; i++) {
    const { path, start } = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].start : raw.length;
    patches.set(path, raw.slice(start, end));
  }
  return patches;
}

export async function getBranchDiffPatchesByPath(
  baseDir: string,
  baseBranch: string,
  headBranch: string,
  options?: CreateGitClientOptions,
): Promise<Map<string, string>> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      try {
        const raw = await git.diff([
          "-M",
          "--patch",
          "--no-color",
          `origin/${baseBranch}...${headBranch}`,
        ]);
        return splitUnifiedDiffByFile(raw);
      } catch {
        return new Map<string, string>();
      }
    },
    { signal: options?.abortSignal },
  );
}

export interface DiffStats {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface GetDiffStatsOptions extends CreateGitClientOptions {
  excludePatterns?: string[];
}

export function computeDiffStatsFromFiles(files: ChangedFileInfo[]): DiffStats {
  let linesAdded = 0;
  let linesRemoved = 0;
  const uniquePaths = new Set<string>();

  for (const file of files) {
    linesAdded += file.linesAdded ?? 0;
    linesRemoved += file.linesRemoved ?? 0;
    uniquePaths.add(file.path);
  }

  return {
    filesChanged: uniquePaths.size,
    linesAdded,
    linesRemoved,
  };
}

export async function getDiffStats(
  baseDir: string,
  options?: GetDiffStatsOptions,
): Promise<DiffStats> {
  const files = await getChangedFilesDetailed(baseDir, options);
  return computeDiffStatsFromFiles(files);
}

export interface SyncStatus {
  aheadOfRemote: number;
  behind: number;
  aheadOfDefault: number;
  hasRemote: boolean;
  currentBranch: string | null;
  isFeatureBranch: boolean;
}

export async function getSyncStatus(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<SyncStatus> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      try {
        const status = await git.status(["--untracked-files=no"]);
        const isDetached = status.detached || status.current === "HEAD";
        const currentBranch = isDetached ? null : status.current || null;

        if (!currentBranch) {
          return {
            aheadOfRemote: 0,
            behind: 0,
            aheadOfDefault: 0,
            hasRemote: false,
            currentBranch: null,
            isFeatureBranch: false,
          };
        }

        const defaultBranch = await detectDefaultBranchWithFallback(git);
        const hasRemote = status.tracking !== null;
        const isFeatureBranch = currentBranch !== defaultBranch;

        let aheadOfDefault = 0;
        if (isFeatureBranch) {
          try {
            const log = await git.log({
              from: `origin/${defaultBranch}`,
              to: currentBranch,
            });
            aheadOfDefault = log.total;
          } catch {}
        }

        return {
          aheadOfRemote: status.ahead,
          behind: status.behind,
          aheadOfDefault,
          hasRemote,
          currentBranch,
          isFeatureBranch,
        };
      } catch {
        return {
          aheadOfRemote: 0,
          behind: 0,
          aheadOfDefault: 0,
          hasRemote: false,
          currentBranch: null,
          isFeatureBranch: false,
        };
      }
    },
    { signal: options?.abortSignal },
  );
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export async function getLatestCommit(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<CommitInfo | null> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      try {
        const log = await git.log({ maxCount: 1 });
        const latest = log.latest;
        if (!latest) return null;

        return {
          sha: latest.hash,
          shortSha: latest.hash.slice(0, 7),
          message: latest.message,
          author: latest.author_name,
          date: latest.date,
        };
      } catch {
        return null;
      }
    },
    { signal: options?.abortSignal },
  );
}

export async function getCommitsBetweenBranches(
  baseDir: string,
  baseBranch: string,
  headBranch?: string,
  maxCount = 50,
  options?: CreateGitClientOptions,
): Promise<CommitInfo[]> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      try {
        const log = await git.log({
          from: `origin/${baseBranch}`,
          to: headBranch ?? "HEAD",
          maxCount,
        });
        return log.all.map((c) => ({
          sha: c.hash,
          shortSha: c.hash.slice(0, 7),
          message: c.message,
          author: c.author_name,
          date: c.date,
        }));
      } catch {
        return [];
      }
    },
    { signal: options?.abortSignal },
  );
}

export interface CommitConventions {
  conventionalCommits: boolean;
  commonPrefixes: string[];
  sampleMessages: string[];
}

export async function getCommitConventions(
  baseDir: string,
  sampleSize = 20,
  options?: CreateGitClientOptions,
): Promise<CommitConventions> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      try {
        const log = await git.log({ maxCount: sampleSize });
        const messages = log.all.map((c) => c.message);

        const conventionalPattern =
          /^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)(\(.+\))?:/;
        const conventionalCount = messages.filter((m) =>
          conventionalPattern.test(m),
        ).length;
        const conventionalCommits = conventionalCount > messages.length * 0.5;

        const prefixes = messages
          .map((m) => m.match(/^([a-z]+)(\(.+\))?:/)?.[1])
          .filter((p): p is string => Boolean(p));
        const prefixCounts = prefixes.reduce(
          (acc, p) => {
            acc[p] = (acc[p] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );
        const commonPrefixes = Object.entries(prefixCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([prefix]) => prefix);

        return {
          conventionalCommits,
          commonPrefixes,
          sampleMessages: messages.slice(0, 5),
        };
      } catch {
        return {
          conventionalCommits: false,
          commonPrefixes: [],
          sampleMessages: [],
        };
      }
    },
    { signal: options?.abortSignal },
  );
}

export async function fetch(
  baseDir: string,
  remote = "origin",
  options?: CreateGitClientOptions,
): Promise<void> {
  const manager = getGitOperationManager();
  await manager.executeWrite(
    baseDir,
    async (git) => {
      await git.fetch(remote);
    },
    { signal: options?.abortSignal },
  );
}

export async function listFiles(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<string[]> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      const output = await git.raw(["ls-files"]);
      return output.split("\n").filter(Boolean);
    },
    { signal: options?.abortSignal },
  );
}

export async function listUntrackedFiles(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<string[]> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      const output = await git.raw([
        "ls-files",
        "--others",
        "--exclude-standard",
      ]);
      return output.split("\n").filter(Boolean);
    },
    { signal: options?.abortSignal },
  );
}

export async function listAllFiles(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<string[]> {
  const [tracked, untracked] = await Promise.all([
    listFiles(baseDir, options),
    listUntrackedFiles(baseDir, options),
  ]);
  return [...tracked, ...untracked];
}

// Tracked + untracked files containing `pattern` (literal, case-insensitive).
// Skips binaries (`-I`). Empty array on no matches.
export async function listFilesContainingText(
  baseDir: string,
  pattern: string,
  options?: CreateGitClientOptions,
): Promise<string[]> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      const output = await git.raw([
        "grep",
        "-l",
        "-i",
        "-I",
        "--untracked",
        "--no-color",
        "--fixed-strings",
        pattern,
      ]);
      return output.split("\n").filter(Boolean);
    },
    { signal: options?.abortSignal },
  );
}

export async function hasTrackedFiles(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<boolean> {
  const files = await listFiles(baseDir, options);
  return files.length > 0;
}

export async function getStagedDiff(
  baseDir: string,
  options?: CreateGitClientOptions & { ignoreWhitespace?: boolean },
): Promise<string> {
  const manager = getGitOperationManager();
  const args = ["--cached", "HEAD"];
  if (options?.ignoreWhitespace) args.push("-w");
  return manager.executeRead(baseDir, (git) => git.diff(args), {
    signal: options?.abortSignal,
  });
}

export async function getUnstagedDiff(
  baseDir: string,
  options?: CreateGitClientOptions & { ignoreWhitespace?: boolean },
): Promise<string> {
  const manager = getGitOperationManager();
  const args: string[] = [];
  if (options?.ignoreWhitespace) args.push("-w");
  return manager.executeRead(baseDir, (git) => git.diff(args), {
    signal: options?.abortSignal,
  });
}

export async function getDiffHead(
  baseDir: string,
  options?: CreateGitClientOptions & { ignoreWhitespace?: boolean },
): Promise<string> {
  const manager = getGitOperationManager();
  const args = ["HEAD"];
  if (options?.ignoreWhitespace) args.push("--ignore-all-space");
  return manager.executeRead(baseDir, (git) => git.diff(args), {
    signal: options?.abortSignal,
  });
}

export async function stageFiles(
  baseDir: string,
  paths: string[],
  options?: CreateGitClientOptions,
): Promise<void> {
  const manager = getGitOperationManager();
  await manager.executeWrite(baseDir, (git) => git.add(paths), {
    signal: options?.abortSignal,
  });
}

export async function unstageFiles(
  baseDir: string,
  paths: string[],
  options?: CreateGitClientOptions,
): Promise<void> {
  const manager = getGitOperationManager();
  await manager.executeWrite(
    baseDir,
    (git) => git.reset(["HEAD", "--", ...paths]),
    { signal: options?.abortSignal },
  );
}

export async function getDiffAgainstRemote(
  baseDir: string,
  baseBranch: string,
  options?: CreateGitClientOptions,
): Promise<string> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    (git) => git.diff([`origin/${baseBranch}...HEAD`]),
    { signal: options?.abortSignal },
  );
}

export async function isCommitOnRemote(
  baseDir: string,
  commit: string,
  options?: CreateGitClientOptions,
): Promise<boolean> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      try {
        const output = await git.branch(["-r", "--contains", commit]);
        return output.all.length > 0;
      } catch {
        return false;
      }
    },
    { signal: options?.abortSignal },
  );
}

export async function resolveGitDir(
  baseDir: string,
  options?: CreateGitClientOptions,
): Promise<string> {
  const manager = getGitOperationManager();
  return manager.executeRead(
    baseDir,
    async (git) => {
      const gitDir = await git.revparse(["--git-dir"]);
      return path.resolve(baseDir, gitDir);
    },
    { signal: options?.abortSignal },
  );
}

export async function addToLocalExclude(
  baseDir: string,
  pattern: string,
  options?: CreateGitClientOptions,
): Promise<void> {
  const manager = getGitOperationManager();
  const excludePath = await manager.executeRead(
    baseDir,
    async (git) => {
      // --git-path resolves to the correct location for both regular repos
      // and worktrees (where info/exclude is shared via the common dir)
      const rel = await git.revparse(["--git-path", "info/exclude"]);
      return path.resolve(baseDir, rel);
    },
    { signal: options?.abortSignal },
  );

  let content = "";
  try {
    content = await fs.readFile(excludePath, "utf-8");
  } catch {}

  const normalizedPattern = pattern.startsWith("/") ? pattern : `/${pattern}`;
  const patternWithoutSlash = pattern.replace(/^\//, "");
  if (
    content.includes(normalizedPattern) ||
    content.includes(patternWithoutSlash)
  ) {
    return;
  }

  const infoDir = path.dirname(excludePath);
  await fs.mkdir(infoDir, { recursive: true });

  const newContent = content.trimEnd()
    ? `${content.trimEnd()}\n${pattern}\n`
    : `${pattern}\n`;
  await fs.writeFile(excludePath, newContent);
}
