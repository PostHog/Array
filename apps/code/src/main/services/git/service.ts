import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import { execGh } from "@posthog/git/gh";
import {
  getAllBranches,
  getBranchDiffPatchesByPath,
  getChangedFilesBetweenBranches,
  getChangedFilesDetailed,
  getCommitConventions,
  getCommitsBetweenBranches,
  getCurrentBranch,
  getDefaultBranch,
  getDiffAgainstRemote,
  getDiffHead,
  getDiffStats,
  getFileAtHead,
  getLatestCommit,
  getRemoteUrl,
  getStagedDiff,
  getSyncStatus,
  getUnstagedDiff,
  fetch as gitFetch,
  isGitRepository,
  stageFiles,
  unstageFiles,
} from "@posthog/git/queries";
import { CreateBranchSaga, SwitchBranchSaga } from "@posthog/git/sagas/branch";
import { CloneSaga } from "@posthog/git/sagas/clone";
import { CommitSaga } from "@posthog/git/sagas/commit";
import { DiscardFileChangesSaga } from "@posthog/git/sagas/discard";
import { PullSaga } from "@posthog/git/sagas/pull";
import { PushSaga } from "@posthog/git/sagas/push";
import { parseGitHubUrl, parsePrUrl } from "@posthog/git/utils";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { LlmGatewayService } from "../llm-gateway/service";
import type { SidebarPrState } from "../workspace/schemas";
import type { WorkspaceService } from "../workspace/service";
import { CreatePrSaga } from "./create-pr-saga";
import type {
  ChangedFile,
  CloneProgressPayload,
  CommitOutput,
  CreatePrOutput,
  CreatePrProgressPayload,
  DetectRepoResult,
  DiffStats,
  DiscardFileChangesOutput,
  GetCommitConventionsOutput,
  GetPrTemplateOutput,
  GhAuthTokenOutput,
  GhStatusOutput,
  GitCommitInfo,
  GitFileStatus,
  GithubRef,
  GithubRefKind,
  GitRepoInfo,
  GitStateSnapshot,
  GitStatusOutput,
  GitSyncStatus,
  OpenPrOutput,
  PrActionType,
  PrDetailsByUrlOutput,
  PrReviewComment,
  PrStatusOutput,
  PublishOutput,
  PullOutput,
  PushOutput,
  ReplyToPrCommentOutput,
  SyncOutput,
  UpdatePrByUrlOutput,
} from "./schemas";

const fsPromises = fs.promises;

export const GitServiceEvent = {
  CloneProgress: "cloneProgress",
  CreatePrProgress: "createPrProgress",
} as const;

export interface GitServiceEvents {
  [GitServiceEvent.CloneProgress]: CloneProgressPayload;
  [GitServiceEvent.CreatePrProgress]: CreatePrProgressPayload;
}

const log = logger.scope("git-service");

const FETCH_THROTTLE_MS = 5 * 60 * 1000;
const MAX_DIFF_LENGTH = 8000;

export function mapPrState(
  state: string | null,
  merged: boolean,
  draft: boolean,
): SidebarPrState {
  const lower = state?.toLowerCase() ?? null;
  if (merged || lower === "merged") return "merged";
  if (lower === "closed") return "closed";
  if (draft) return "draft";
  if (lower === "open") return "open";
  return null;
}

/**
 * Wraps a GitHub API per-file patch (hunk content only) with
 * the `diff --git` / `---` / `+++` header so that unified-diff
 * parsers like `@pierre/diffs` can process it correctly.
 */
function toUnifiedDiffPatch(
  rawPatch: string,
  filename: string,
  previousFilename: string | undefined,
  status: ChangedFile["status"],
): string {
  const oldPath = previousFilename ?? filename;
  const fromPath = status === "added" ? "/dev/null" : `a/${oldPath}`;
  const toPath = status === "deleted" ? "/dev/null" : `b/${filename}`;
  return `diff --git a/${oldPath} b/${filename}\n--- ${fromPath}\n+++ ${toPath}\n${rawPatch}`;
}

@injectable()
export class GitService extends TypedEventEmitter<GitServiceEvents> {
  private lastFetchTime = new Map<string, number>();

  constructor(
    @inject(MAIN_TOKENS.LlmGatewayService)
    private readonly llmGateway: LlmGatewayService,
    @inject(MAIN_TOKENS.WorkspaceService)
    private readonly workspaceService: WorkspaceService,
  ) {
    super();
  }

  private async getStateSnapshot(
    directoryPath: string,
    options?: {
      includeChangedFiles?: boolean;
      includeDiffStats?: boolean;
      includeSyncStatus?: boolean;
      includeLatestCommit?: boolean;
      includePrStatus?: boolean;
      forceRefresh?: boolean;
    },
  ): Promise<GitStateSnapshot> {
    const {
      includeChangedFiles = true,
      includeDiffStats = true,
      includeSyncStatus = true,
      includeLatestCommit = true,
      includePrStatus = false,
    } = options ?? {};

    const results = await Promise.allSettled([
      includeChangedFiles ? this.getChangedFilesHead(directoryPath) : null,
      includeDiffStats ? this.getDiffStats(directoryPath) : null,
      includeSyncStatus
        ? this.getGitSyncStatusInternal(directoryPath, true)
        : null,
      includeLatestCommit ? this.getLatestCommit(directoryPath) : null,
      includePrStatus ? this.getPrStatus(directoryPath) : null,
    ]);

    const getValue = <T>(r: PromiseSettledResult<T | null>): T | undefined =>
      r.status === "fulfilled" && r.value !== null ? r.value : undefined;

    return {
      changedFiles: getValue(results[0]),
      diffStats: getValue(results[1]),
      syncStatus: getValue(results[2]),
      latestCommit: getValue(results[3]),
      prStatus: getValue(results[4]),
    };
  }

  private async fetchIfStale(directoryPath: string): Promise<void> {
    const now = Date.now();
    const lastFetch = this.lastFetchTime.get(directoryPath) ?? 0;
    if (now - lastFetch > FETCH_THROTTLE_MS) {
      try {
        await gitFetch(directoryPath);
        this.lastFetchTime.set(directoryPath, now);
      } catch {}
    }
  }

  private async getGitSyncStatusInternal(
    directoryPath: string,
    forceRefresh = false,
  ): Promise<GitSyncStatus> {
    if (forceRefresh) {
      this.lastFetchTime.delete(directoryPath);
    }
    await this.fetchIfStale(directoryPath);

    const status = await getSyncStatus(directoryPath);
    return {
      aheadOfRemote: status.aheadOfRemote,
      behind: status.behind,
      aheadOfDefault: status.aheadOfDefault,
      hasRemote: status.hasRemote,
      currentBranch: status.currentBranch,
      isFeatureBranch: status.isFeatureBranch,
    };
  }

  public async detectRepo(
    directoryPath: string,
  ): Promise<DetectRepoResult | null> {
    if (!directoryPath) return null;

    const remoteUrl = await getRemoteUrl(directoryPath);
    if (!remoteUrl) return null;

    const repo = parseGitHubUrl(remoteUrl);
    if (!repo) return null;

    const branch = await getCurrentBranch(directoryPath);
    if (!branch) return null;

    return {
      organization: repo.organization,
      repository: repo.repository,
      remote: remoteUrl,
      branch,
    };
  }

  public async validateRepo(directoryPath: string): Promise<boolean> {
    if (!directoryPath) return false;
    return isGitRepository(directoryPath);
  }

  public async cloneRepository(
    repoUrl: string,
    targetPath: string,
    cloneId: string,
  ): Promise<{ cloneId: string }> {
    const emitProgress = (
      status: CloneProgressPayload["status"],
      message: string,
    ) => {
      this.emit(GitServiceEvent.CloneProgress, { cloneId, status, message });
    };

    emitProgress("cloning", `Starting clone of ${repoUrl}...`);

    const saga = new CloneSaga();
    const result = await saga.run({
      repoUrl,
      targetPath,
      onProgress: (stage, progress, processed, total) => {
        const pct = progress ? ` ${Math.round(progress)}%` : "";
        const count = total ? ` (${processed}/${total})` : "";
        emitProgress("cloning", `${stage}${pct}${count}`);
      },
    });
    if (!result.success) {
      emitProgress("error", result.error);
      throw new Error(result.error);
    }
    emitProgress("complete", "Clone completed successfully");
    return { cloneId };
  }

  public async getRemoteUrl(directoryPath: string): Promise<string | null> {
    return getRemoteUrl(directoryPath);
  }

  public async getCurrentBranch(directoryPath: string): Promise<string | null> {
    return getCurrentBranch(directoryPath);
  }

  public async getDefaultBranch(directoryPath: string): Promise<string> {
    return getDefaultBranch(directoryPath);
  }

  public async getAllBranches(directoryPath: string): Promise<string[]> {
    return getAllBranches(directoryPath);
  }

  public async createBranch(
    directoryPath: string,
    branchName: string,
  ): Promise<void> {
    const saga = new CreateBranchSaga();
    const result = await saga.run({ baseDir: directoryPath, branchName });
    if (!result.success) throw new Error(result.error);
  }

  public async checkoutBranch(
    directoryPath: string,
    branchName: string,
  ): Promise<{ previousBranch: string; currentBranch: string }> {
    const saga = new SwitchBranchSaga();
    const result = await saga.run({ baseDir: directoryPath, branchName });
    if (!result.success) throw new Error(result.error);
    return result.data;
  }

  public async getChangedFilesHead(
    directoryPath: string,
  ): Promise<ChangedFile[]> {
    const files = await getChangedFilesDetailed(directoryPath, {
      excludePatterns: [".claude", "CLAUDE.local.md"],
    });
    return files.map((f) => ({
      path: f.path,
      status: f.status,
      originalPath: f.originalPath,
      linesAdded: f.linesAdded,
      linesRemoved: f.linesRemoved,
      staged: f.staged,
    }));
  }

  public async getFileAtHead(
    directoryPath: string,
    filePath: string,
  ): Promise<string | null> {
    return getFileAtHead(directoryPath, filePath);
  }

  public async getDiffHead(
    directoryPath: string,
    ignoreWhitespace?: boolean,
  ): Promise<string> {
    return getDiffHead(directoryPath, { ignoreWhitespace });
  }

  public async getDiffCached(
    directoryPath: string,
    ignoreWhitespace?: boolean,
  ): Promise<string> {
    return getStagedDiff(directoryPath, { ignoreWhitespace });
  }

  public async getDiffUnstaged(
    directoryPath: string,
    ignoreWhitespace?: boolean,
  ): Promise<string> {
    return getUnstagedDiff(directoryPath, { ignoreWhitespace });
  }

  public async stageFiles(
    directoryPath: string,
    paths: string[],
  ): Promise<GitStateSnapshot> {
    await stageFiles(directoryPath, paths);
    return this.getStateSnapshot(directoryPath);
  }

  public async unstageFiles(
    directoryPath: string,
    paths: string[],
  ): Promise<GitStateSnapshot> {
    await unstageFiles(directoryPath, paths);
    return this.getStateSnapshot(directoryPath);
  }

  public async getDiffStats(directoryPath: string): Promise<DiffStats> {
    const stats = await getDiffStats(directoryPath, {
      excludePatterns: [".claude", "CLAUDE.local.md"],
    });
    return {
      filesChanged: stats.filesChanged,
      linesAdded: stats.linesAdded,
      linesRemoved: stats.linesRemoved,
    };
  }

  public async discardFileChanges(
    directoryPath: string,
    filePath: string,
    fileStatus: GitFileStatus,
  ): Promise<DiscardFileChangesOutput> {
    const saga = new DiscardFileChangesSaga();
    const result = await saga.run({
      baseDir: directoryPath,
      filePath,
      fileStatus,
    });
    if (!result.success) {
      return { success: false };
    }

    const state = await this.getStateSnapshot(directoryPath, {
      includeSyncStatus: false,
      includeLatestCommit: false,
    });

    return { success: true, state };
  }

  public async getGitSyncStatus(
    directoryPath: string,
    forceRefresh = false,
  ): Promise<GitSyncStatus> {
    return this.getGitSyncStatusInternal(directoryPath, forceRefresh);
  }

  public async getLatestCommit(
    directoryPath: string,
  ): Promise<GitCommitInfo | null> {
    const commit = await getLatestCommit(directoryPath);
    if (!commit) return null;
    return {
      sha: commit.sha,
      shortSha: commit.shortSha,
      message: commit.message,
      author: commit.author,
      date: commit.date,
    };
  }

  public async getGitRepoInfo(
    directoryPath: string,
  ): Promise<GitRepoInfo | null> {
    try {
      const remoteUrl = await getRemoteUrl(directoryPath);
      if (!remoteUrl) return null;

      const parsed = parseGitHubUrl(remoteUrl);
      if (!parsed) return null;

      const currentBranch = await getCurrentBranch(directoryPath);
      const defaultBranch = await getDefaultBranch(directoryPath);

      let compareUrl: string | null = null;
      if (currentBranch && currentBranch !== defaultBranch) {
        compareUrl = `https://github.com/${parsed.path}/compare/${defaultBranch}...${currentBranch}?expand=1`;
      }

      return {
        organization: parsed.organization,
        repository: parsed.repository,
        currentBranch: currentBranch ?? null,
        defaultBranch,
        compareUrl,
      };
    } catch {
      return null;
    }
  }

  public async push(
    directoryPath: string,
    remote = "origin",
    branch?: string,
    setUpstream = false,
    signal?: AbortSignal,
  ): Promise<PushOutput> {
    const saga = new PushSaga();
    const result = await saga.run({
      baseDir: directoryPath,
      remote,
      branch: branch || undefined,
      setUpstream,
      signal,
    });
    if (!result.success) {
      return { success: false, message: result.error };
    }

    const state = await this.getStateSnapshot(directoryPath, {
      includeChangedFiles: false,
      includeDiffStats: false,
      includeLatestCommit: false,
    });

    return {
      success: true,
      message: `Pushed ${result.data.branch} to ${result.data.remote}`,
      state,
    };
  }

  public async pull(
    directoryPath: string,
    remote = "origin",
    branch?: string,
    signal?: AbortSignal,
  ): Promise<PullOutput> {
    const saga = new PullSaga();
    const result = await saga.run({
      baseDir: directoryPath,
      remote,
      branch: branch || undefined,
      signal,
    });
    if (!result.success) {
      return { success: false, message: result.error };
    }

    const state = await this.getStateSnapshot(directoryPath);

    return {
      success: true,
      message: `${result.data.changes} files changed`,
      updatedFiles: result.data.changes,
      state,
    };
  }

  public async publish(
    directoryPath: string,
    remote = "origin",
    signal?: AbortSignal,
  ): Promise<PublishOutput> {
    const currentBranch = await getCurrentBranch(directoryPath);
    if (!currentBranch) {
      return { success: false, message: "No branch to publish", branch: "" };
    }

    const pushResult = await this.push(
      directoryPath,
      remote,
      currentBranch,
      true,
      signal,
    );
    return {
      success: pushResult.success,
      message: pushResult.message,
      branch: currentBranch,
      state: pushResult.state,
    };
  }

  public async sync(
    directoryPath: string,
    remote = "origin",
    signal?: AbortSignal,
  ): Promise<SyncOutput> {
    const pullResult = await this.pull(
      directoryPath,
      remote,
      undefined,
      signal,
    );
    if (!pullResult.success) {
      return {
        success: false,
        pullMessage: pullResult.message,
        pushMessage: "Skipped due to pull failure",
      };
    }

    const pushResult = await this.push(
      directoryPath,
      remote,
      undefined,
      false,
      signal,
    );

    const state = await this.getStateSnapshot(directoryPath);

    return {
      success: pushResult.success,
      pullMessage: pullResult.message,
      pushMessage: pushResult.message,
      state,
    };
  }

  public async createPr(input: {
    directoryPath: string;
    flowId: string;
    branchName?: string;
    commitMessage?: string;
    prTitle?: string;
    prBody?: string;
    draft?: boolean;
    stagedOnly?: boolean;
    taskId?: string;
    conversationContext?: string;
  }): Promise<CreatePrOutput> {
    const { directoryPath, flowId } = input;

    const emitProgress = (
      step: CreatePrProgressPayload["step"],
      message: string,
      prUrl?: string,
    ) => {
      this.emit(GitServiceEvent.CreatePrProgress, {
        flowId,
        step,
        message,
        prUrl,
      });
    };

    const saga = new CreatePrSaga(
      {
        getCurrentBranch: (dir) => getCurrentBranch(dir),
        createBranch: (dir, name) => this.createBranch(dir, name),
        checkoutBranch: (dir, name) => this.checkoutBranch(dir, name),
        getChangedFilesHead: (dir) => this.getChangedFilesHead(dir),
        generateCommitMessage: (dir) =>
          this.generateCommitMessage(dir, input.conversationContext),
        commit: (dir, msg, opts) => this.commit(dir, msg, opts),
        getSyncStatus: (dir) => this.getGitSyncStatus(dir),
        push: (dir) => this.push(dir),
        publish: (dir) => this.publish(dir),
        generatePrTitleAndBody: (dir) =>
          this.generatePrTitleAndBody(dir, input.conversationContext),
        createPr: (dir, title, body, draft) =>
          this.createPrViaGh(dir, title, body, draft),
        onProgress: emitProgress,
      },
      log,
    );

    const result = await saga.run({
      directoryPath,
      branchName: input.branchName,
      commitMessage: input.commitMessage,
      prTitle: input.prTitle,
      prBody: input.prBody,
      draft: input.draft,
      stagedOnly: input.stagedOnly,
      taskId: input.taskId,
    });

    if (!result.success) {
      emitProgress("error", result.error);
      return {
        success: false,
        message: result.error,
        prUrl: null,
        failedStep: result.failedStep as CreatePrOutput["failedStep"],
      };
    }

    const state = await this.getStateSnapshot(directoryPath, {
      includePrStatus: true,
    });

    if (input.taskId) {
      const linkedBranch =
        input.branchName ?? (await getCurrentBranch(directoryPath));
      if (linkedBranch) {
        this.workspaceService.linkBranch(input.taskId, linkedBranch, "user");
      }
    }

    emitProgress(
      "complete",
      "Pull request created",
      result.data.prUrl ?? undefined,
    );

    return {
      success: true,
      message: "Pull request created",
      prUrl: result.data.prUrl,
      failedStep: null,
      state,
    };
  }

  public async getPrTemplate(
    directoryPath: string,
  ): Promise<GetPrTemplateOutput> {
    const templatePaths = [
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/pull_request_template.md",
      "PULL_REQUEST_TEMPLATE.md",
      "pull_request_template.md",
      "docs/PULL_REQUEST_TEMPLATE.md",
    ];

    for (const relativePath of templatePaths) {
      const fullPath = path.join(directoryPath, relativePath);
      try {
        const content = await fsPromises.readFile(fullPath, "utf-8");
        return { template: content, templatePath: relativePath };
      } catch {}
    }

    return { template: null, templatePath: null };
  }

  public async getCommitConventions(
    directoryPath: string,
    sampleSize = 20,
  ): Promise<GetCommitConventionsOutput> {
    return getCommitConventions(directoryPath, sampleSize);
  }

  public async commit(
    directoryPath: string,
    message: string,
    options?: {
      paths?: string[];
      allowEmpty?: boolean;
      stagedOnly?: boolean;
      taskId?: string;
    },
  ): Promise<CommitOutput> {
    const fail = (msg: string): CommitOutput => ({
      success: false,
      message: msg,
      commitSha: null,
      branch: null,
    });

    if (!message.trim()) return fail("Commit message is required");

    const saga = new CommitSaga();
    const result = await saga.run({
      baseDir: directoryPath,
      message: message.trim(),
      ...options,
    });

    if (!result.success) return fail(result.error);

    const state = await this.getStateSnapshot(directoryPath);

    return {
      success: true,
      message: `Committed ${result.data.commitSha.slice(0, 7)}`,
      commitSha: result.data.commitSha,
      branch: result.data.branch,
      state,
    };
  }

  public async getGitStatus(): Promise<GitStatusOutput> {
    try {
      const { stdout } = await execFileAsync("git", ["--version"]);
      const version = stdout.trim().replace("git version ", "");
      return { installed: true, version };
    } catch {
      return { installed: false, version: null };
    }
  }

  public async getGhStatus(): Promise<GhStatusOutput> {
    const versionResult = await execGh(["--version"]);
    if (versionResult.exitCode !== 0) {
      return {
        installed: false,
        version: null,
        authenticated: false,
        username: null,
        error: versionResult.error ?? versionResult.stderr ?? null,
      };
    }

    const version = versionResult.stdout.split("\n")[0]?.trim() ?? null;
    const authResult = await execGh(["auth", "status"]);
    const authenticated = authResult.exitCode === 0;
    const authOutput = `${authResult.stdout}\n${authResult.stderr}`;
    const usernameMatch = authOutput.match(
      /Logged in to github.com (?:as |account )(\S+)/,
    );

    return {
      installed: true,
      version,
      authenticated,
      username: usernameMatch?.[1] ?? null,
      error: authenticated
        ? null
        : authResult.stderr || authResult.error || null,
    };
  }

  public async getGhAuthToken(): Promise<GhAuthTokenOutput> {
    const result = await execGh(["auth", "token"]);
    if (result.exitCode !== 0) {
      return {
        success: false,
        token: null,
        error:
          result.stderr || result.error || "Failed to read GitHub auth token",
      };
    }

    const token = result.stdout.trim();
    if (!token) {
      return {
        success: false,
        token: null,
        error: "GitHub auth token is empty",
      };
    }

    return {
      success: true,
      token,
      error: null,
    };
  }

  public async getPrStatus(directoryPath: string): Promise<PrStatusOutput> {
    const base: PrStatusOutput = {
      hasRemote: false,
      isGitHubRepo: false,
      currentBranch: null,
      defaultBranch: null,
      prExists: false,
      prUrl: null,
      prState: null,
      baseBranch: null,
      headBranch: null,
      isDraft: null,
      error: null,
    };

    try {
      const remoteUrl = await getRemoteUrl(directoryPath);
      const isGitHubRepo = !!(remoteUrl && parseGitHubUrl(remoteUrl));
      const currentBranch = await getCurrentBranch(directoryPath);
      const defaultBranch = await getDefaultBranch(directoryPath).catch(
        () => null,
      );

      if (!isGitHubRepo || !currentBranch) {
        return {
          ...base,
          hasRemote: !!remoteUrl,
          isGitHubRepo,
          currentBranch,
          defaultBranch,
        };
      }

      const prResult = await execGh(
        ["pr", "view", "--json", "url,state,baseRefName,headRefName,isDraft"],
        { cwd: directoryPath },
      );

      const shared = {
        hasRemote: true,
        isGitHubRepo: true,
        currentBranch,
        defaultBranch,
      };

      if (prResult.exitCode !== 0) {
        return { ...base, ...shared };
      }

      const data = JSON.parse(prResult.stdout) as {
        url?: string;
        state?: string;
        baseRefName?: string;
        headRefName?: string;
        isDraft?: boolean;
      };

      return {
        ...base,
        ...shared,
        prExists: !!data.url,
        prUrl: data.url ?? null,
        prState: data.state ?? null,
        baseBranch: data.baseRefName ?? null,
        headBranch: data.headRefName ?? null,
        isDraft: data.isDraft ?? null,
      };
    } catch (error) {
      return {
        ...base,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Look up the PR URL for any branch name (not just the currently checked-out
   * one). Uses `gh pr list --head` rather than `gh pr view` so the lookup works
   * regardless of which branch the working tree is on.
   */
  public async getPrUrlForBranch(
    directoryPath: string,
    branchName: string,
  ): Promise<string | null> {
    try {
      const remoteUrl = await getRemoteUrl(directoryPath);
      if (!remoteUrl) return null;

      const parsed = parseGitHubUrl(remoteUrl);
      if (!parsed) return null;

      const result = await execGh([
        "pr",
        "list",
        "--head",
        branchName,
        "--state",
        "all",
        "--json",
        "url",
        "--limit",
        "1",
        "--repo",
        parsed.path,
      ]);

      if (result.exitCode !== 0) {
        log.warn("Failed to list PRs for branch", {
          branchName,
          error: result.stderr || result.error,
        });
        return null;
      }

      const data = JSON.parse(result.stdout) as Array<{ url?: string }>;
      return data[0]?.url ?? null;
    } catch (error) {
      log.warn("Failed to resolve PR URL for branch", { branchName, error });
      return null;
    }
  }

  private async createPrViaGh(
    directoryPath: string,
    title?: string,
    body?: string,
    draft?: boolean,
  ): Promise<{ success: boolean; message: string; prUrl: string | null }> {
    const prFooter =
      "\n\n---\n*Created with [PostHog Code](https://posthog.com/code?ref=pr)*";

    const args = ["pr", "create"];
    if (title) {
      args.push("--title", title);
      args.push("--body", (body || "") + prFooter);
    } else {
      args.push("--fill");
    }
    if (draft) args.push("--draft");

    const result = await execGh(args, { cwd: directoryPath });
    if (result.exitCode !== 0) {
      return {
        success: false,
        message: result.stderr || result.error || "Failed to create PR",
        prUrl: null,
      };
    }

    const prUrlMatch = result.stdout.match(/https:\/\/github\.com\/[^\s]+/);
    const prUrl = prUrlMatch?.[0] ?? null;

    return {
      success: true,
      message: "Pull request created",
      prUrl,
    };
  }

  public async openPr(directoryPath: string): Promise<OpenPrOutput> {
    const result = await execGh(["pr", "view", "--json", "url"], {
      cwd: directoryPath,
    });

    if (result.exitCode !== 0) {
      return {
        success: false,
        message: result.stderr || result.error || "Failed to fetch PR",
        prUrl: null,
      };
    }

    const data = JSON.parse(result.stdout) as { url?: string };
    const prUrl = data.url ?? null;
    return { success: !!prUrl, message: prUrl ? "OK" : "No PR found", prUrl };
  }

  public async getPrChangedFiles(prUrl: string): Promise<ChangedFile[]> {
    const pr = parsePrUrl(prUrl);
    if (!pr) return [];

    const { owner, repo, number } = pr;

    try {
      const result = await execGh([
        "api",
        `repos/${owner}/${repo}/pulls/${number}/files`,
        "--paginate",
        "--slurp",
      ]);

      if (result.exitCode !== 0) {
        throw new Error(
          `Failed to fetch PR files: ${result.stderr || result.error || "Unknown error"}`,
        );
      }

      const pages = JSON.parse(result.stdout) as Array<
        Array<{
          filename: string;
          status: string;
          previous_filename?: string;
          additions: number;
          deletions: number;
          patch?: string;
        }>
      >;
      const files = pages.flat();

      return files.map((f) => {
        let status: ChangedFile["status"];
        switch (f.status) {
          case "added":
            status = "added";
            break;
          case "removed":
            status = "deleted";
            break;
          case "renamed":
            status = "renamed";
            break;
          default:
            status = "modified";
            break;
        }

        return {
          path: f.filename,
          status,
          originalPath: f.previous_filename,
          linesAdded: f.additions,
          linesRemoved: f.deletions,
          patch: f.patch
            ? toUnifiedDiffPatch(
                f.patch,
                f.filename,
                f.previous_filename,
                status,
              )
            : undefined,
        };
      });
    } catch (error) {
      log.warn("Failed to fetch PR changed files", { prUrl, error });
      throw error;
    }
  }

  public async getPrDetailsByUrl(
    prUrl: string,
  ): Promise<PrDetailsByUrlOutput | null> {
    const pr = parsePrUrl(prUrl);
    if (!pr) return null;

    try {
      const result = await execGh([
        "api",
        `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`,
        "--jq",
        "{state,merged,draft}",
      ]);

      if (result.exitCode !== 0) {
        log.warn("Failed to fetch PR details", {
          prUrl,
          error: result.stderr || result.error,
        });
        return null;
      }

      const data = JSON.parse(result.stdout) as {
        state: string;
        merged: boolean;
        draft: boolean;
      };

      return data;
    } catch (error) {
      log.warn("Failed to fetch PR details", { prUrl, error });
      return null;
    }
  }

  public async updatePrByUrl(
    prUrl: string,
    action: PrActionType,
  ): Promise<UpdatePrByUrlOutput> {
    const pr = parsePrUrl(prUrl);
    if (!pr) {
      return { success: false, message: "Invalid PR URL" };
    }

    try {
      const args =
        action === "draft"
          ? ["pr", "ready", "--undo", String(pr.number)]
          : ["pr", action, String(pr.number)];

      const result = await execGh([
        ...args,
        "--repo",
        `${pr.owner}/${pr.repo}`,
      ]);

      if (result.exitCode !== 0) {
        const errorMsg = result.stderr || result.error || "Unknown error";
        log.warn("Failed to update PR", { prUrl, action, error: errorMsg });
        return { success: false, message: errorMsg };
      }

      return { success: true, message: result.stdout };
    } catch (error) {
      log.warn("Failed to update PR", { prUrl, action, error });
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  public async getPrReviewComments(prUrl: string): Promise<PrReviewComment[]> {
    const pr = parsePrUrl(prUrl);
    if (!pr) return [];

    const { owner, repo, number } = pr;

    try {
      const result = await execGh([
        "api",
        `repos/${owner}/${repo}/pulls/${number}/comments`,
        "--paginate",
        "--slurp",
      ]);

      if (result.exitCode !== 0) {
        throw new Error(
          `Failed to fetch PR review comments: ${result.stderr || result.error || "Unknown error"}`,
        );
      }

      const pages = JSON.parse(result.stdout) as PrReviewComment[][];
      return pages.flat();
    } catch (error) {
      log.warn("Failed to fetch PR review comments", { prUrl, error });
      throw error;
    }
  }

  public async replyToPrComment(
    prUrl: string,
    commentId: number,
    body: string,
  ): Promise<ReplyToPrCommentOutput> {
    const pr = parsePrUrl(prUrl);
    if (!pr) {
      return { success: false, comment: null };
    }

    try {
      const result = await execGh([
        "api",
        `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/comments/${commentId}/replies`,
        "-X",
        "POST",
        "-f",
        `body=${body}`,
      ]);

      if (result.exitCode !== 0) {
        log.warn("Failed to reply to PR comment", {
          prUrl,
          commentId,
          error: result.stderr || result.error,
        });
        return { success: false, comment: null };
      }

      const data = JSON.parse(result.stdout) as PrReviewComment;
      return { success: true, comment: data };
    } catch (error) {
      log.warn("Failed to reply to PR comment", { prUrl, commentId, error });
      return { success: false, comment: null };
    }
  }

  public async getBranchChangedFiles(
    repo: string,
    branch: string,
  ): Promise<ChangedFile[]> {
    const parts = repo.split("/");
    if (parts.length !== 2) return [];

    const [owner, repoName] = parts;

    const repoResult = await execGh([
      "api",
      `repos/${owner}/${repoName}`,
      "--jq",
      ".default_branch",
    ]);

    if (repoResult.exitCode !== 0 || !repoResult.stdout.trim()) {
      return [];
    }
    const defaultBranch = repoResult.stdout.trim();

    const result = await execGh([
      "api",
      `repos/${owner}/${repoName}/compare/${defaultBranch}...${branch}`,
    ]);

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to fetch branch files: ${result.stderr || result.error || "Unknown error"}`,
      );
    }

    const response = JSON.parse(result.stdout) as {
      files?: Array<{
        filename: string;
        status: string;
        previous_filename?: string;
        additions: number;
        deletions: number;
        patch?: string;
      }>;
    };
    const files = response.files;

    if (!files) return [];

    return files.map((f) => {
      let status: ChangedFile["status"];
      switch (f.status) {
        case "added":
          status = "added";
          break;
        case "removed":
          status = "deleted";
          break;
        case "renamed":
          status = "renamed";
          break;
        default:
          status = "modified";
          break;
      }

      return {
        path: f.filename,
        status,
        originalPath: f.previous_filename,
        linesAdded: f.additions,
        linesRemoved: f.deletions,
        patch: f.patch
          ? toUnifiedDiffPatch(f.patch, f.filename, f.previous_filename, status)
          : undefined,
      };
    });
  }

  public async getLocalBranchChangedFiles(
    directoryPath: string,
    branch: string,
  ): Promise<ChangedFile[]> {
    await this.fetchIfStale(directoryPath);

    const defaultBranch = await getDefaultBranch(directoryPath);
    if (!defaultBranch) return [];

    const files = await getChangedFilesBetweenBranches(
      directoryPath,
      defaultBranch,
      branch,
      { excludePatterns: [".claude", "CLAUDE.local.md"] },
    );
    if (files.length === 0) return [];

    const patchByPath = await getBranchDiffPatchesByPath(
      directoryPath,
      defaultBranch,
      branch,
    );

    return files.map((f) => ({
      path: f.path,
      status: f.status,
      originalPath: f.originalPath,
      linesAdded: f.linesAdded,
      linesRemoved: f.linesRemoved,
      patch: patchByPath.get(f.path),
    }));
  }

  public async generateCommitMessage(
    directoryPath: string,
    conversationContext?: string,
  ): Promise<{ message: string }> {
    const [stagedDiff, unstagedDiff, conventions, changedFiles] =
      await Promise.all([
        getStagedDiff(directoryPath),
        getUnstagedDiff(directoryPath),
        getCommitConventions(directoryPath),
        this.getChangedFilesHead(directoryPath),
      ]);

    const diff = stagedDiff || unstagedDiff;
    if (!diff && changedFiles.length === 0) {
      return { message: "" };
    }

    const truncatedDiff =
      diff.length > MAX_DIFF_LENGTH
        ? `${diff.slice(0, MAX_DIFF_LENGTH)}\n... (diff truncated)`
        : diff;

    const filesSummary = changedFiles
      .map((f) => `${f.status}: ${f.path}`)
      .join("\n");

    const conventionHint = conventions.conventionalCommits
      ? `This repository uses conventional commits. Common prefixes: ${
          conventions.commonPrefixes.join(", ") || "feat, fix, docs, chore"
        }.
Example messages from this repo:
${conventions.sampleMessages.slice(0, 3).join("\n")}`
      : `Example messages from this repo:
${conventions.sampleMessages.slice(0, 3).join("\n")}`;

    const system = `You are a git commit message generator. Generate a concise, descriptive commit message for the given changes.

${conventionHint}

Rules:
- First line should be a short summary (max 72 chars)
- Use imperative mood ("Add feature" not "Added feature")
- Be specific about what changed
- If using conventional commits, include the appropriate prefix
- If conversation context is provided, use it to understand WHY the changes were made and reflect that intent
- Do not include any explanation, just output the commit message`;

    const contextSection = conversationContext
      ? `\n\nConversation context (why these changes were made):\n${conversationContext}`
      : "";

    const userMessage = `Generate a commit message for these changes:

Changed files:
${filesSummary}

Diff:
${truncatedDiff}${contextSection}`;

    log.debug("Generating commit message", {
      fileCount: changedFiles.length,
      diffLength: diff.length,
      conventionalCommits: conventions.conventionalCommits,
      hasConversationContext: !!conversationContext,
    });

    const response = await this.llmGateway.prompt(
      [{ role: "user", content: userMessage }],
      { system },
    );

    return { message: response.content.trim() };
  }

  public async generatePrTitleAndBody(
    directoryPath: string,
    conversationContext?: string,
  ): Promise<{ title: string; body: string }> {
    await this.fetchIfStale(directoryPath);

    const [defaultBranch, currentBranch, prTemplate] = await Promise.all([
      getDefaultBranch(directoryPath),
      getCurrentBranch(directoryPath),
      this.getPrTemplate(directoryPath),
    ]);

    const head = currentBranch ?? undefined;
    const [branchDiff, stagedDiff, unstagedDiff, commits, conventions] =
      await Promise.all([
        getDiffAgainstRemote(directoryPath, defaultBranch),
        getStagedDiff(directoryPath),
        getUnstagedDiff(directoryPath),
        getCommitsBetweenBranches(directoryPath, defaultBranch, head, 30),
        getCommitConventions(directoryPath),
      ]);

    const uncommittedDiff = [stagedDiff, unstagedDiff]
      .filter(Boolean)
      .join("\n");
    const parts = [branchDiff, uncommittedDiff].filter(Boolean);
    const fullDiff = parts.join("\n");
    if (commits.length === 0 && !fullDiff) {
      return { title: "", body: "" };
    }
    const commitsSummary = commits.map((c) => `- ${c.message}`).join("\n");
    const truncatedDiff = fullDiff
      ? fullDiff.length > MAX_DIFF_LENGTH
        ? `${fullDiff.slice(0, MAX_DIFF_LENGTH)}\n... (diff truncated)`
        : fullDiff
      : "";

    const templateHint = prTemplate.template
      ? `The repository has a PR template. Use it as a guide for structure but adapt the content to match the actual changes:\n${prTemplate.template.slice(
          0,
          2000,
        )}`
      : "";

    const conventionHint = conventions.conventionalCommits
      ? `- Use conventional commit format for the title (e.g., "feat(scope): description"). Common prefixes: ${
          conventions.commonPrefixes.join(", ") || "feat, fix, docs, chore"
        }.`
      : "";

    const system = `You are a PR description generator. Generate a title and detailed description for a pull request.

Output format (use exactly this format):
TITLE: <short descriptive title, max 72 chars>

BODY:
<detailed description>

Rules for the title:
- Short and descriptive (max 72 chars)
- Use imperative mood ("Add feature" not "Added feature")
- Be specific about what the PR accomplishes
${conventionHint}

Rules for the body:
- Start with a TL;DR section (1-2 sentences summarizing the change)
- Include a "What changed?" section with bullet points describing the key changes
- If conversation context is provided, use it to explain WHY the changes were made in the TL;DR
- Be thorough but concise
- Use markdown formatting
- Only describe changes that are actually in the diff — do not invent or assume changes
${templateHint}

Do not include any explanation outside the TITLE and BODY sections.`;

    const contextSection = conversationContext
      ? `\n\nConversation context (why these changes were made):\n${conversationContext}`
      : "";

    const userMessage = `Generate a PR title and description for these changes:

Branch: ${currentBranch ?? "unknown"} -> ${defaultBranch}

Commits in this PR:
${commitsSummary || "(no commits yet - changes are uncommitted)"}

Diff:
${truncatedDiff || "(no diff available)"}${contextSection}`;

    log.debug("Generating PR title and body", {
      commitCount: commits.length,
      diffLength: fullDiff.length,
      hasTemplate: !!prTemplate.template,
      hasConversationContext: !!conversationContext,
      conventionalCommits: conventions.conventionalCommits,
    });

    const response = await this.llmGateway.prompt(
      [{ role: "user", content: userMessage }],
      { system, maxTokens: 2000 },
    );

    const content = response.content.trim();
    const titleMatch = content.match(/^TITLE:\s*(.+?)(?:\n|$)/m);
    const bodyMatch = content.match(/BODY:\s*([\s\S]+)$/m);

    return {
      title: titleMatch?.[1]?.trim() ?? "",
      body: bodyMatch?.[1]?.trim() ?? "",
    };
  }

  private async resolveCanonicalRepo(repo: string): Promise<string> {
    const result = await execGh([
      "repo",
      "view",
      repo,
      "--json",
      "name,owner",
      "--jq",
      '.owner.login + "/" + .name',
    ]);
    if (result.exitCode !== 0) return repo;
    return result.stdout.trim() || repo;
  }

  private normalizeRefState(raw: string): GithubRef["state"] {
    const upper = raw.toUpperCase();
    if (upper === "OPEN") return "OPEN";
    if (upper === "MERGED") return "MERGED";
    return "CLOSED";
  }

  private parseGhRefs(
    stdout: string,
    repo: string,
    kind: GithubRefKind,
  ): GithubRef[] {
    const raw = JSON.parse(stdout) as Array<{
      number: number;
      title: string;
      state: string;
      labels?: Array<{ name: string }>;
      url: string;
      isDraft?: boolean;
    }>;
    const items = Array.isArray(raw) ? raw : [raw];
    return items.map((item) => {
      // GitHub's issues API returns PRs too, so derive kind from the URL path.
      const resolvedKind: GithubRefKind = item.url.includes("/pull/")
        ? "pr"
        : kind;
      return {
        kind: resolvedKind,
        number: item.number,
        title: item.title,
        state: this.normalizeRefState(item.state),
        labels: (item.labels ?? []).map((l) => l.name),
        url: item.url,
        repo,
        isDraft: resolvedKind === "pr" ? Boolean(item.isDraft) : undefined,
      };
    });
  }

  public async searchGithubRefs(
    directoryPath: string,
    query?: string,
    limit = 5,
    kinds: GithubRefKind[] = ["issue", "pr"],
  ): Promise<GithubRef[]> {
    const repoInfo = await this.getGitRepoInfo(directoryPath);
    if (!repoInfo) return [];

    const repo = await this.resolveCanonicalRepo(
      `${repoInfo.organization}/${repoInfo.repository}`,
    );

    const trimmed = query?.trim().replace(/^#/, "");
    const refNumber = trimmed ? Number(trimmed) : Number.NaN;

    // Number lookup: `gh issue view` returns PRs too (shared number space).
    if (!Number.isNaN(refNumber) && Number.isInteger(refNumber)) {
      return this.fetchGhRefs(
        ["issue", "view", String(refNumber), "--repo", repo],
        repo,
        "issue",
      );
    }

    // Text search: one call via `gh search issues --include-prs` when both kinds are wanted.
    if (trimmed) {
      const includeIssues = kinds.includes("issue");
      const includePrs = kinds.includes("pr");
      const searchNoun = !includeIssues && includePrs ? "prs" : "issues";
      const args = [
        "search",
        searchNoun,
        trimmed,
        "--repo",
        repo,
        "--limit",
        String(limit),
        "--match",
        "title",
      ];
      if (searchNoun === "issues" && includePrs) args.push("--include-prs");
      return this.fetchGhRefs(args, repo, "issue");
    }

    // Empty query: list defaults per-kind in parallel (`gh search` requires a query).
    const tasks: Promise<GithubRef[]>[] = [];
    if (kinds.includes("issue")) {
      tasks.push(
        this.fetchGhRefs(
          [
            "issue",
            "list",
            "--repo",
            repo,
            "--limit",
            String(limit),
            "--state",
            "all",
          ],
          repo,
          "issue",
        ),
      );
    }
    if (kinds.includes("pr")) {
      tasks.push(
        this.fetchGhRefs(
          [
            "pr",
            "list",
            "--repo",
            repo,
            "--limit",
            String(limit),
            "--state",
            "all",
          ],
          repo,
          "pr",
        ),
      );
    }
    const results = await Promise.all(tasks);
    return this.sortRefs(this.dedupeRefsByUrl(results.flat()));
  }

  private dedupeRefsByUrl(refs: GithubRef[]): GithubRef[] {
    const byUrl = new Map<string, GithubRef>();
    for (const ref of refs) {
      if (!byUrl.has(ref.url)) byUrl.set(ref.url, ref);
    }
    return [...byUrl.values()];
  }

  private sortRefs(refs: GithubRef[]): GithubRef[] {
    return refs.sort((a, b) => b.number - a.number);
  }

  public async getGithubIssue(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GithubRef | null> {
    const repoSlug = `${owner}/${repo}`;
    const refs = await this.fetchGhRefs(
      ["issue", "view", String(number), "--repo", repoSlug],
      repoSlug,
      "issue",
    );
    return refs[0] ?? null;
  }

  public async getGithubPullRequest(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GithubRef | null> {
    const repoSlug = `${owner}/${repo}`;
    const refs = await this.fetchGhRefs(
      ["pr", "view", String(number), "--repo", repoSlug],
      repoSlug,
      "pr",
    );
    return refs[0] ?? null;
  }

  private async fetchGhRefs(
    args: string[],
    repo: string,
    kind: GithubRefKind,
  ): Promise<GithubRef[]> {
    const jsonFields =
      kind === "pr"
        ? "number,title,state,url,isDraft"
        : "number,title,state,labels,url";
    const result = await execGh([...args, "--json", jsonFields]);
    if (result.exitCode !== 0) return [];

    try {
      return this.parseGhRefs(result.stdout, repo, kind);
    } catch {
      log.warn("Failed to parse GitHub refs response", { repo, kind, args });
      return [];
    }
  }

  async getTaskPrStatus(
    taskId: string,
    cloudPrUrl: string | null,
  ): Promise<{ prState: SidebarPrState; hasDiff: boolean }> {
    const workspace = await this.workspaceService.getWorkspace(taskId);
    if (!workspace) return { prState: null, hasDiff: false };

    const { mode, worktreePath, folderPath, linkedBranch } = workspace;
    const isCloud = mode === "cloud";
    const repoPath = worktreePath ?? (folderPath || null);

    // Cloud tasks: look up PR details by the cloud run's PR URL
    if (isCloud && cloudPrUrl) {
      const details = await this.getPrDetailsByUrl(cloudPrUrl);
      if (details) {
        return {
          prState: mapPrState(details.state, details.merged, details.draft),
          hasDiff: false,
        };
      }
      return { prState: null, hasDiff: false };
    }

    if (isCloud) return { prState: null, hasDiff: false };

    // Linked branch: look up PR by branch name
    if (linkedBranch && repoPath) {
      const prUrl = await this.getPrUrlForBranch(repoPath, linkedBranch);
      if (prUrl) {
        const details = await this.getPrDetailsByUrl(prUrl);
        if (details) {
          return {
            prState: mapPrState(details.state, details.merged, details.draft),
            hasDiff: false,
          };
        }
      }
      return { prState: null, hasDiff: false };
    }

    // Worktree tasks without linked branch: check current branch PR + diff
    if (worktreePath) {
      const prStatus = await this.getPrStatus(worktreePath);
      if (prStatus.prExists && prStatus.prState) {
        return {
          prState: mapPrState(
            prStatus.prState,
            false,
            prStatus.isDraft ?? false,
          ),
          hasDiff: false,
        };
      }

      const [diffStats, syncStatus] = await Promise.all([
        this.getDiffStats(worktreePath),
        this.getGitSyncStatus(worktreePath),
      ]);

      const hasDiff =
        (diffStats?.filesChanged ?? 0) > 0 ||
        (syncStatus?.aheadOfDefault ?? 0) > 0;

      return { prState: null, hasDiff };
    }

    return { prState: null, hasDiff: false };
  }
}
