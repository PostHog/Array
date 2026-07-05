import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  GitHandoffCheckpoint,
  HandoffLocalGitState,
  SagaLogger,
} from "@posthog/shared";
import { createGitClient, type GitClient } from "./client";
import {
  CaptureCheckpointSaga,
  deleteCheckpoint,
  materializeCheckpointRefFromMetadata,
} from "./sagas/checkpoint";

export type {
  GitHandoffCheckpoint,
  HandoffLocalGitState,
} from "@posthog/shared";

const HANDOFF_HEAD_REF_PREFIX = "refs/posthog-code-handoff/head/";
const CHECKPOINT_REF_PREFIX = "refs/posthog-code-checkpoint/";
const MAX_HANDOFF_FILE_BYTES = 1024 * 1024;

export interface GitHandoffArtifactFile {
  path: string;
  rawBytes: number;
}

export interface GitHandoffCaptureResult {
  checkpoint: GitHandoffCheckpoint;
  headPack?: GitHandoffArtifactFile;
  indexFile: GitHandoffArtifactFile;
  totalBytes: number;
}

export interface GitHandoffApplyInput {
  checkpoint: GitHandoffCheckpoint;
  headPackPath?: string;
  indexPath?: string;
  localGitState?: HandoffLocalGitState;
  onDivergedBranch?: (
    divergence: GitHandoffBranchDivergence,
  ) => Promise<boolean>;
}

export interface GitHandoffApplyResult {
  packBytes: number;
  indexBytes: number;
  totalBytes: number;
}

export interface GitHandoffBranchDivergence {
  branch: string;
  localHead: string;
  cloudHead: string;
}

export interface GitHandoffTrackerConfig {
  repositoryPath: string;
  logger?: SagaLogger;
}

interface GitTrackingMetadata {
  upstreamRemote: string | null;
  upstreamMergeRef: string | null;
  remoteUrl: string | null;
}

type GitBranchRestoreStatus =
  | { kind: "missing" }
  | { kind: "match" }
  | { kind: "fast_forward" }
  | { kind: "diverged"; divergence: GitHandoffBranchDivergence };

export class GitHandoffTracker {
  private repositoryPath: string;
  private logger?: SagaLogger;

  constructor(config: GitHandoffTrackerConfig) {
    this.repositoryPath = config.repositoryPath;
    this.logger = config.logger;
  }

  async captureForHandoff(
    localGitState?: HandoffLocalGitState,
  ): Promise<GitHandoffCaptureResult> {
    const captureSaga = new CaptureCheckpointSaga(this.logger);
    const result = await captureSaga.run({ baseDir: this.repositoryPath });
    if (!result.success) {
      throw new Error(
        `Failed to capture checkpoint at step '${result.failedStep}': ${result.error}`,
      );
    }

    const checkpoint = result.data;
    const git = createGitClient(this.repositoryPath);
    const tempDir = await this.createTempDir(checkpoint.checkpointId);
    const checkpointRef = `${CHECKPOINT_REF_PREFIX}${checkpoint.checkpointId}`;

    try {
      const reconciledIndex = await this.reconcileHandoffIndex(
        git,
        checkpoint.head,
        checkpoint.indexTree,
        tempDir,
        checkpoint.checkpointId,
      );

      // Choose a differential baseline: a commit the RECEIVER already has, so the pack
      // only carries the objects they lack. The sender's upstream HEAD is ideal; when it
      // isn't supplied (e.g. per-turn cloud captures carry no handoff state) derive the
      // branch's upstream tracking commit from git directly. Without any baseline,
      // pack-objects has no negative ref and packs the ENTIRE repo, blowing past the 30MB
      // artifact limit.
      //
      // One case we must block: packBaselineRaw === checkpoint.head. `^HEAD` excludes
      // everything reachable from HEAD — including HEAD itself — yielding an empty pack that
      // omits the very commit we're shipping, so the receiver's read-tree fails with
      // "Not a valid commit name". All other cases (ancestor, diverged, or equal-to-tip with
      // only worktree changes) are safe: `git pack-objects --revs` with a diverged baseline
      // packs only objects unique to HEAD's ancestry, which is exactly what the receiver
      // lacks. A correct full pack is always safer than a tiny broken one, so when no valid
      // baseline is found we fall back to null.
      const packBaselineRaw =
        localGitState?.upstreamHead ??
        (await this.resolveUpstreamBaseline(git, checkpoint.branch));
      // Only exclude the baseline as a negative ref if it exists locally (otherwise
      // pack-objects fails with "fatal: bad object") and is not identical to HEAD
      // (which would produce an empty pack).
      const packBaseline =
        packBaselineRaw &&
        packBaselineRaw !== checkpoint.head &&
        (await this.refExists(git, packBaselineRaw))
          ? packBaselineRaw
          : null;
      const packRefs = [
        checkpoint.head,
        reconciledIndex.indexTree,
        checkpoint.worktreeTree,
        packBaseline ? `^${packBaseline}` : null,
      ].filter((ref): ref is string => !!ref);
      const headRef = checkpoint.head
        ? `${HANDOFF_HEAD_REF_PREFIX}${checkpoint.checkpointId}`
        : undefined;
      const packPrefix = path.join(tempDir, checkpoint.checkpointId);

      const [headPack, indexFile, tracking] = await Promise.all([
        this.captureObjectPack(packPrefix, packRefs),
        this.statFileArtifact(reconciledIndex.indexFilePath),
        getTrackingMetadata(git, checkpoint.branch),
      ]);

      return {
        checkpoint: {
          checkpointId: checkpoint.checkpointId,
          commit: checkpoint.commit,
          checkpointRef,
          headRef,
          head: checkpoint.head,
          branch: checkpoint.branch,
          indexTree: reconciledIndex.indexTree,
          worktreeTree: checkpoint.worktreeTree,
          timestamp: checkpoint.timestamp,
          upstreamRemote: tracking.upstreamRemote,
          upstreamMergeRef: tracking.upstreamMergeRef,
          remoteUrl: tracking.remoteUrl,
          packBaseline,
        },
        headPack,
        indexFile,
        totalBytes: (headPack?.rawBytes ?? 0) + indexFile.rawBytes,
      };
    } finally {
      await deleteCheckpoint(git, checkpoint.checkpointId).catch(() => {});
    }
  }

  async applyFromHandoff(
    input: GitHandoffApplyInput,
  ): Promise<GitHandoffApplyResult> {
    const {
      checkpoint,
      headPackPath,
      indexPath,
      localGitState,
      onDivergedBranch,
    } = input;
    const git = createGitClient(this.repositoryPath);

    this.logger?.info("Handoff apply: starting", {
      checkpointId: checkpoint.checkpointId,
      branch: checkpoint.branch,
      head: checkpoint.head,
      worktreeTree: checkpoint.worktreeTree,
      packBaseline: checkpoint.packBaseline ?? null,
      upstreamRemote: checkpoint.upstreamRemote,
      upstreamMergeRef: checkpoint.upstreamMergeRef,
      hasHeadPack: !!headPackPath,
      hasLocalGitState: !!localGitState,
    });

    if (headPackPath) {
      await this.ensureBaselineForApply(git, checkpoint, localGitState);
      await this.unpackPackFile(headPackPath);
    }

    if (checkpoint.branch && checkpoint.head) {
      const branchStatus = await this.resolveBranchRestoreStatus(
        git,
        checkpoint.branch,
        checkpoint.head,
        localGitState,
      );
      const tracking = this.getPreferredTracking(localGitState, checkpoint);

      if (
        branchStatus.kind === "diverged" &&
        !(await onDivergedBranch?.(branchStatus.divergence))
      ) {
        throw new Error(
          `Handoff aborted: local branch '${checkpoint.branch}' has diverged`,
        );
      }

      await this.checkoutBranchAtHead(git, checkpoint.branch, checkpoint.head);

      if (this.shouldRestoreTracking(branchStatus, localGitState, tracking)) {
        await this.ensureRemoteForTracking(git, tracking);
        await this.configureUpstream(git, checkpoint.branch, tracking);
      }
    } else if (checkpoint.head) {
      await git.checkout(checkpoint.head);
    }

    await git.clean(["f", "d"]);
    try {
      await git.raw(["read-tree", "--reset", "-u", checkpoint.worktreeTree]);
    } catch (err) {
      this.logger?.error("Handoff apply: read-tree failed", {
        worktreeTree: checkpoint.worktreeTree,
        packBaseline: checkpoint.packBaseline ?? null,
        err: String(err),
      });
      throw err;
    }

    if (indexPath) {
      await this.restoreIndexFile(git, indexPath);
    }

    const packBytes = headPackPath ? await this.getFileSize(headPackPath) : 0;
    const indexBytes = indexPath ? await this.getFileSize(indexPath) : 0;

    return {
      packBytes,
      indexBytes,
      totalBytes: packBytes + indexBytes,
    };
  }

  /**
   * Materializes a restorable checkpoint ref (refs/posthog-code-checkpoint/<id>) from a
   * handoff pack WITHOUT mutating the working tree. Use this on the receiver to make every
   * cloud/handoff checkpoint individually restorable after a cloud→local handoff: the
   * caller's apply_git_checkpoint step already sets the final working-tree state, so the
   * sync pass only needs to recreate the refs (applyFromHandoff resets the tree per call,
   * which is both unnecessary here and clobbering).
   *
   * Unpacks the pack's objects (head/index/worktree trees + their blobs), then rebuilds the
   * meta-commit + ref from the checkpoint metadata. Idempotent — a ref that already exists
   * is left untouched.
   */
  async materializeCheckpointRef(
    input: GitHandoffApplyInput,
  ): Promise<{ created: boolean; commit: string; packBytes: number }> {
    const { checkpoint, headPackPath, localGitState } = input;
    const git = createGitClient(this.repositoryPath);

    this.logger?.info("Handoff materialize: starting", {
      checkpointId: checkpoint.checkpointId,
      head: checkpoint.head,
      worktreeTree: checkpoint.worktreeTree,
      indexTree: checkpoint.indexTree,
      hasHeadPack: !!headPackPath,
    });

    if (headPackPath) {
      await this.ensureBaselineForApply(git, checkpoint, localGitState);
      await this.unpackPackFile(headPackPath);
    }

    const result = await materializeCheckpointRefFromMetadata(
      git,
      this.repositoryPath,
      {
        checkpointId: checkpoint.checkpointId,
        head: checkpoint.head,
        branch: checkpoint.branch,
        indexTree: checkpoint.indexTree,
        worktreeTree: checkpoint.worktreeTree,
        timestamp: checkpoint.timestamp,
      },
    );

    const packBytes = headPackPath ? await this.getFileSize(headPackPath) : 0;

    this.logger?.info("Handoff materialize: done", {
      checkpointId: checkpoint.checkpointId,
      created: result.created,
      commit: result.commit,
    });

    return { ...result, packBytes };
  }

  private async captureObjectPack(
    packPrefix: string,
    refs: string[],
  ): Promise<GitHandoffArtifactFile> {
    const hash = await this.runGitWithInput(
      ["pack-objects", packPrefix, "--revs"],
      `${refs.join("\n")}\n`,
    );
    const packPath = `${packPrefix}-${hash.trim()}.pack`;
    const rawBytes = await this.getFileSize(packPath);
    await rm(`${packPath}.idx`, { force: true }).catch(() => {});
    return { path: packPath, rawBytes };
  }

  private async reconcileHandoffIndex(
    git: GitClient,
    head: string | null,
    indexTree: string,
    tempDir: string,
    checkpointId: string,
  ): Promise<{ indexTree: string; indexFilePath: string }> {
    const realIndexPath = await this.getGitPath(git, "index");
    const tempIndexPath = path.join(tempDir, `${checkpointId}.index`);
    await copyFile(realIndexPath, tempIndexPath);

    const largePaths = await this.listLargeBlobsInTree(
      indexTree,
      MAX_HANDOFF_FILE_BYTES,
    );
    if (largePaths.length === 0) {
      return { indexTree, indexFilePath: tempIndexPath };
    }

    const headBlobs = head
      ? await this.readHeadBlobsForPaths(head, largePaths)
      : new Map<string, { mode: string; hash: string }>();

    const env = { ...process.env, GIT_INDEX_FILE: tempIndexPath };
    for (const filePath of largePaths) {
      const headBlob = headBlobs.get(filePath);
      if (headBlob) {
        await this.runGitWithEnv(env, [
          "update-index",
          "--cacheinfo",
          `${headBlob.mode},${headBlob.hash},${filePath}`,
        ]);
      } else {
        await this.runGitWithEnv(env, [
          "update-index",
          "--force-remove",
          filePath,
        ]).catch(() => {});
      }
    }

    const reconciledTree = (
      await this.runGitWithEnv(env, ["write-tree"])
    ).trim();
    return { indexTree: reconciledTree, indexFilePath: tempIndexPath };
  }

  private async listLargeBlobsInTree(
    tree: string,
    maxBytes: number,
  ): Promise<string[]> {
    const { stdout } = await this.runGitProcess(
      ["ls-tree", "-r", "-l", tree],
      "",
    );
    const result: string[] = [];
    for (const line of stdout.split("\n")) {
      if (!line) continue;
      const tabIndex = line.indexOf("\t");
      if (tabIndex < 0) continue;
      const meta = line.slice(0, tabIndex);
      const filePath = line.slice(tabIndex + 1);
      const parts = meta.split(/\s+/);
      if (parts.length < 4) continue;
      const [, type, , sizeStr] = parts;
      if (type !== "blob") continue;
      if (sizeStr === "-") continue;
      const size = Number.parseInt(sizeStr, 10);
      if (Number.isFinite(size) && size > maxBytes) {
        result.push(filePath);
      }
    }
    return result;
  }

  private async readHeadBlobsForPaths(
    head: string,
    paths: string[],
  ): Promise<Map<string, { mode: string; hash: string }>> {
    const result = new Map<string, { mode: string; hash: string }>();
    const CHUNK_SIZE = 100;
    for (let i = 0; i < paths.length; i += CHUNK_SIZE) {
      const chunk = paths.slice(i, i + CHUNK_SIZE);
      const { stdout } = await this.runGitProcess(
        ["ls-tree", "-r", head, "--", ...chunk],
        "",
      ).catch(() => ({ stdout: "", stderr: "" }));
      for (const line of stdout.split("\n")) {
        if (!line) continue;
        const tabIndex = line.indexOf("\t");
        if (tabIndex < 0) continue;
        const meta = line.slice(0, tabIndex);
        const filePath = line.slice(tabIndex + 1);
        const parts = meta.split(/\s+/);
        if (parts.length < 3) continue;
        const [mode, type, hash] = parts;
        if (type !== "blob") continue;
        result.set(filePath, { mode, hash });
      }
    }
    return result;
  }

  private async statFileArtifact(
    filePath: string,
  ): Promise<GitHandoffArtifactFile> {
    return { path: filePath, rawBytes: await this.getFileSize(filePath) };
  }

  private async restoreIndexFile(
    git: GitClient,
    indexPath: string,
  ): Promise<void> {
    const gitIndexPath = await this.getGitPath(git, "index");
    await copyFile(indexPath, gitIndexPath);
  }

  private async unpackPackFile(packPath: string): Promise<void> {
    const content = await readFile(packPath);
    // pack-objects without --thin produces complete, self-contained packs. unpack-objects
    // extracts each object as a loose file, which works correctly for self-contained packs.
    // ensureBaselineForApply ensures the baseline's tree objects are present before this
    // runs, so read-tree can resolve all subtree references after unpacking.
    await this.runGitWithBuffer(["unpack-objects", "-r"], content);
  }

  private getPreferredTracking(
    localGitState: HandoffLocalGitState | undefined,
    checkpoint: GitHandoffCheckpoint,
  ): GitTrackingMetadata {
    const state = localGitState;
    if (state && hasTrackingConfig(state)) {
      return {
        upstreamRemote: state.upstreamRemote ?? null,
        upstreamMergeRef: state.upstreamMergeRef ?? null,
        remoteUrl:
          state.upstreamRemote &&
          state.upstreamRemote === checkpoint.upstreamRemote
            ? checkpoint.remoteUrl
            : null,
      };
    }

    return {
      upstreamRemote: checkpoint.upstreamRemote,
      upstreamMergeRef: checkpoint.upstreamMergeRef,
      remoteUrl: checkpoint.remoteUrl,
    };
  }

  private shouldRestoreTracking(
    branchStatus: GitBranchRestoreStatus,
    localGitState: HandoffLocalGitState | undefined,
    tracking: GitTrackingMetadata,
  ): boolean {
    return (
      branchStatus.kind === "missing" ||
      (!hasTrackingConfig(localGitState) &&
        (tracking.upstreamRemote !== null ||
          tracking.upstreamMergeRef !== null))
    );
  }

  private async ensureBaselineForApply(
    git: GitClient,
    checkpoint: GitHandoffCheckpoint,
    localGitState: HandoffLocalGitState | undefined,
  ): Promise<void> {
    // Always use the LOCAL remote for URL/connectivity — the checkpoint's remote may not
    // be reachable from the receiver (e.g. "cloud-origin" → https://... from a test).
    // But fetch the CHECKPOINT's branch ref, because the baseline lives on the sender's
    // branch (e.g. a feature branch), not necessarily the receiver's current branch (which
    // may be main).  The same GitHub origin hosts both branches.
    const preferredTracking = this.getPreferredTracking(localGitState, checkpoint);
    const upstreamRemote = preferredTracking.upstreamRemote;
    const upstreamMergeRef = checkpoint.upstreamMergeRef ?? preferredTracking.upstreamMergeRef;
    if (!upstreamRemote || !upstreamMergeRef) {
      this.logger?.warn(
        "Handoff baseline: no remote/ref to fetch baseline from; differential pack may fail to apply",
        {
          packBaseline: checkpoint.packBaseline ?? null,
          upstreamRemote,
          upstreamMergeRef,
          hasLocalGitState: !!localGitState,
        },
      );
      return;
    }

    await this.ensureRemoteForTracking(git, preferredTracking).catch(() => {});

    // The handoff pack is differential — it omits every object reachable from the sender's
    // upstream baseline, assuming the receiver already has them. Cloud sandboxes are SHALLOW
    // clones (--depth 1) and may not have the baseline commit's tree objects, causing
    // read-tree to fail with "fatal: failed to unpack tree object".
    //
    // We deepen the clone enough to recover the baseline commit and its trees. --unshallow
    // downloads the entire repo history (potentially GBs for large repos and always times
    // out); bounded deepening is fast and covers any typical dev workflow.
    let isShallow = false;
    try {
      isShallow =
        (await git.raw(["rev-parse", "--is-shallow-repository"])).trim() === "true";
    } catch {
      // Older git without --is-shallow-repository — treat as non-shallow.
    }

    const baseline = checkpoint.packBaseline;
    const baselinePresentBefore = baseline
      ? await this.refExists(git, baseline)
      : false;

    this.logger?.info("Handoff baseline: resolved", {
      baseline: baseline ?? null,
      isShallow,
      baselinePresentBefore,
      upstreamRemote,
      upstreamMergeRef,
    });

    if (isShallow && baseline) {
      // Deepen to include packBaseline's commit and its tree objects.
      // 200 commits covers weeks of typical development velocity.
      await git
        .raw(["fetch", "--deepen=200", upstreamRemote, upstreamMergeRef])
        .catch((err) => {
          this.logger?.error("Handoff deepen fetch failed", {
            err: String(err),
            depth: 200,
            remote: upstreamRemote,
            ref: upstreamMergeRef,
          });
        });

      this.logger?.info("Handoff baseline: after --deepen=200", {
        baseline,
        baselinePresent: await this.refExists(git, baseline),
      });

      if (!(await this.refExists(git, baseline))) {
        // Baseline still absent — local was very stale. Try a deeper fetch
        // (covers months-old baselines; cumulative on top of the first deepen).
        await git
          .raw(["fetch", "--deepen=2000", upstreamRemote, upstreamMergeRef])
          .catch((err) => {
            this.logger?.error("Handoff extended deepen failed", {
              err: String(err),
              depth: 2000,
              remote: upstreamRemote,
              ref: upstreamMergeRef,
            });
          });

        this.logger?.info("Handoff baseline: after --deepen=2000", {
          baseline,
          baselinePresent: await this.refExists(git, baseline),
        });

        if (!(await this.refExists(git, baseline))) {
          this.logger?.warn(
            "Pack baseline not found after deepening; checkpoint apply may fail with missing-object errors",
            { baseline, remote: upstreamRemote, ref: upstreamMergeRef },
          );
        }
      }
    } else if (!isShallow && baseline && !(await this.refExists(git, baseline))) {
      // Non-shallow receiver, differential pack, baseline not yet present locally.
      // Fetch to pull in the baseline objects before unpacking.
      await git.raw(["fetch", upstreamRemote, upstreamMergeRef]).catch((err) => {
        this.logger?.error(
          "Handoff baseline fetch failed; unpack/read-tree may fail with missing-object errors",
          { err: String(err), remote: upstreamRemote, ref: upstreamMergeRef },
        );
      });
    }
  }

  private async ensureRemoteForTracking(
    git: GitClient,
    tracking: GitTrackingMetadata,
  ): Promise<void> {
    if (!tracking.upstreamRemote || !tracking.remoteUrl) return;

    const remotes = await git.getRemotes(true);
    const existing = remotes.find(
      (remote) => remote.name === tracking.upstreamRemote,
    );

    if (!existing) {
      await git.addRemote(tracking.upstreamRemote, tracking.remoteUrl);
    }
  }

  private async configureUpstream(
    git: GitClient,
    branch: string,
    tracking: GitTrackingMetadata,
  ): Promise<void> {
    if (tracking.upstreamRemote) {
      await git.raw([
        "config",
        `branch.${branch}.remote`,
        tracking.upstreamRemote,
      ]);
    }

    if (tracking.upstreamMergeRef) {
      await git.raw([
        "config",
        `branch.${branch}.merge`,
        tracking.upstreamMergeRef,
      ]);
    }
  }

  private async resolveBranchRestoreStatus(
    git: GitClient,
    branch: string,
    cloudHead: string,
    localGitState?: HandoffLocalGitState,
  ): Promise<GitBranchRestoreStatus> {
    const branchRef = `refs/heads/${branch}`;
    const branchExists = await this.refExists(git, branchRef);
    if (!branchExists) {
      return { kind: "missing" };
    }

    const currentBranchHead = (await git.revparse([branchRef])).trim();
    const candidateHeads = [
      currentBranchHead,
      ...(localGitState?.branch === branch && localGitState.head
        ? [localGitState.head]
        : []),
    ].filter((value, index, array) => array.indexOf(value) === index);

    if (candidateHeads.every((head) => head === cloudHead)) {
      return { kind: "match" };
    }

    const nonAncestorHead = await this.findNonAncestorHead(
      git,
      candidateHeads,
      cloudHead,
    );
    if (!nonAncestorHead) {
      return { kind: "fast_forward" };
    }

    return {
      kind: "diverged",
      divergence: {
        branch,
        localHead: nonAncestorHead,
        cloudHead,
      },
    };
  }

  private async findNonAncestorHead(
    _git: GitClient,
    heads: string[],
    cloudHead: string,
  ): Promise<string | null> {
    for (const head of heads) {
      if (head === cloudHead) {
        continue;
      }
      if (!(await this.isAncestor(head, cloudHead))) {
        return head;
      }
    }
    return null;
  }

  private async checkoutBranchAtHead(
    git: GitClient,
    branch: string,
    head: string,
  ): Promise<void> {
    const currentBranch = await getCurrentBranchName(git);
    if (currentBranch === branch) {
      await git.reset(["--hard", head]);
      return;
    }

    const branchRef = `refs/heads/${branch}`;
    if (await this.refExists(git, branchRef)) {
      await git.branch(["-f", branch, head]);
      await git.checkout(branch);
      return;
    }

    await git.checkout(["-b", branch, head]);
  }

  private async refExists(git: GitClient, ref: string): Promise<boolean> {
    try {
      await git.revparse(["--verify", ref]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the branch's upstream tracking commit from git directly, for callers that
   * have no handoff state to supply one (e.g. per-turn cloud captures). Tries the branch's
   * configured upstream, then the conventional origin/<branch>, then origin/HEAD. Returns
   * the resolved commit SHA, or null when none can be resolved.
   */
  private async resolveUpstreamBaseline(
    git: GitClient,
    branch?: string | null,
  ): Promise<string | null> {
    const candidates = [
      branch ? `${branch}@{upstream}` : null,
      branch ? `origin/${branch}` : null,
      "origin/HEAD",
    ].filter((ref): ref is string => !!ref);
    for (const ref of candidates) {
      try {
        const sha = (await git.revparse(["--verify", `${ref}^{commit}`])).trim();
        if (sha) {
          return sha;
        }
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  }

  private async isAncestor(
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    const exitCode = await this.runGitProcessAllowingFailure([
      "merge-base",
      "--is-ancestor",
      ancestor,
      descendant,
    ]);
    return exitCode === 0;
  }

  /**
   * Packs an existing local checkpoint commit for cloud upload. Reads the
   * checkpoint ref from local git, parses its metadata from the commit message,
   * creates a pack from its objects, and returns the artifact + full metadata.
   * Returns null if the ref doesn't exist or packing fails.
   */
  async packExistingCheckpoint(
    checkpointId: string,
    baseline?: string | null,
  ): Promise<{
    artifact: GitHandoffArtifactFile;
    checkpoint: GitHandoffCheckpoint;
  } | null> {
    const checkpointRef = `${CHECKPOINT_REF_PREFIX}${checkpointId}`;
    const git = createGitClient(this.repositoryPath);

    let commit: string;
    try {
      commit = (await git.revparse([checkpointRef])).trim();
    } catch {
      return null;
    }

    const rawMessage = await git.raw(["show", "-s", "--format=%B", commit]);
    const meta = parseHandoffCheckpointMeta(rawMessage);
    const tracking = await getTrackingMetadata(git, meta.branch);

    const tempDir = await this.createTempDir(checkpointId);
    const packPrefix = path.join(tempDir, checkpointId);

    // Pack the checkpoint ref + head commit; exclude baseline to keep packs
    // differential. Verify the baseline exists before using it as a negative ref:
    // the caller's upstream HEAD may be a commit this repo doesn't have (e.g. the
    // upstream advanced after the local ref was recorded), which would make
    // git pack-objects abort with "fatal: bad object <hash>" and silently drop the
    // checkpoint. Fall back to a full pack if absent. Mirrors captureForHandoff().
    //
    // CRITICAL: the worktree/index trees MUST be explicit pack refs. The receiver
    // applies the checkpoint with `read-tree --reset -u <worktreeTree>`, but the
    // checkpoint commit's own tree is NOT necessarily the recorded worktreeTree
    // (the commit may be built from a reconciled/index tree). Packing only the
    // commit therefore omits the worktreeTree object, and a shallow receiver — which
    // can't fall back to local history — fails with
    // "fatal: failed to unpack tree object <worktreeTree>". Including them here
    // mirrors captureForHandoff()'s ref list and keeps the pack self-sufficient.
    const safeBaseline =
      baseline && (await this.refExists(git, baseline)) ? baseline : null;
    const packRefs = [
      checkpointRef,
      meta.head,
      meta.worktreeTree,
      meta.indexTree,
      safeBaseline ? `^${safeBaseline}` : null,
    ].filter((r): r is string => !!r);

    const artifact = await this.captureObjectPack(packPrefix, packRefs);

    return {
      artifact,
      checkpoint: {
        checkpointId,
        commit,
        checkpointRef,
        head: meta.head,
        branch: meta.branch,
        indexTree: meta.indexTree ?? "",
        worktreeTree: meta.worktreeTree ?? "",
        timestamp: meta.timestamp ?? new Date().toISOString(),
        upstreamRemote: tracking.upstreamRemote,
        upstreamMergeRef: tracking.upstreamMergeRef,
        remoteUrl: tracking.remoteUrl,
        packBaseline: safeBaseline ?? null,
      },
    };
  }

  private async createTempDir(checkpointId: string): Promise<string> {
    return mkdtemp(joinTempPrefix(checkpointId));
  }

  private async getGitPath(git: GitClient, gitPath: string): Promise<string> {
    const raw = await git.raw(["rev-parse", "--git-path", gitPath]);
    const resolved = raw.trim();
    return path.isAbsolute(resolved)
      ? resolved
      : path.resolve(this.repositoryPath, resolved);
  }

  private async getFileSize(filePath: string): Promise<number> {
    return (await stat(filePath)).size;
  }

  private async runGitWithInput(
    args: string[],
    input: string,
  ): Promise<string> {
    const { stdout } = await this.runGitProcess(args, input);
    return stdout;
  }

  private async runGitWithBuffer(args: string[], input: Buffer): Promise<void> {
    await this.runGitProcess(args, input);
  }

  private async runGitProcessAllowingFailure(args: string[]): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: this.repositoryPath,
        stdio: ["ignore", "ignore", "pipe"],
      });

      let stderr = "";
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === null) {
          reject(new Error(`git ${args.join(" ")} exited unexpectedly`));
          return;
        }
        if (code > 1) {
          reject(
            new Error(
              stderr || `git ${args.join(" ")} failed with code ${code}`,
            ),
          );
          return;
        }
        resolve(code);
      });
    });
  }

  private async runGitWithEnv(
    env: NodeJS.ProcessEnv,
    args: string[],
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: this.repositoryPath,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(
          new Error(stderr || `git ${args.join(" ")} failed with code ${code}`),
        );
      });
    });
  }

  private runGitProcess(
    args: string[],
    input: string | Buffer,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: this.repositoryPath,
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(
          new Error(stderr || `git ${args.join(" ")} failed with code ${code}`),
        );
      });

      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  }
}

function joinTempPrefix(checkpointId: string): string {
  return path.join(tmpdir(), `posthog-code-handoff-${checkpointId}-`);
}

function parseHandoffCheckpointMeta(message: string): {
  head: string | null;
  branch: string | null;
  indexTree: string | null;
  worktreeTree: string | null;
  timestamp: string | null;
} {
  const result = {
    head: null as string | null,
    branch: null as string | null,
    indexTree: null as string | null,
    worktreeTree: null as string | null,
    timestamp: null as string | null,
  };
  for (const line of message.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx < 0) continue;
    const key = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim();
    if (!value || value === "null") continue;
    if (key === "head") result.head = value;
    else if (key === "branch") result.branch = value;
    else if (key === "index") result.indexTree = value;
    else if (key === "worktree") result.worktreeTree = value;
    else if (key === "timestamp") result.timestamp = value;
  }
  return result;
}

export async function readHandoffLocalGitState(
  repositoryPath: string,
): Promise<HandoffLocalGitState> {
  const git = createGitClient(repositoryPath);
  const head = await readCurrentHead(git);
  const branch = await getCurrentBranchName(git);
  const tracking = await getTrackingMetadata(git, branch);

  if (tracking.upstreamRemote && tracking.upstreamMergeRef) {
    await git
      .raw(["fetch", tracking.upstreamRemote, tracking.upstreamMergeRef])
      .catch(() => {});
  }

  const upstreamHead =
    tracking.upstreamRemote && tracking.upstreamMergeRef
      ? await resolveUpstreamHead(
          git,
          tracking.upstreamRemote,
          tracking.upstreamMergeRef,
        )
      : null;

  return {
    head,
    branch,
    upstreamHead,
    upstreamRemote: tracking.upstreamRemote,
    upstreamMergeRef: tracking.upstreamMergeRef,
  };
}

async function readCurrentHead(git: GitClient): Promise<string | null> {
  try {
    return (await git.revparse(["HEAD"])).trim() || null;
  } catch {
    return null;
  }
}

async function getCurrentBranchName(git: GitClient): Promise<string | null> {
  try {
    const raw = await git.revparse(["--abbrev-ref", "HEAD"]);
    const branch = raw.trim();
    return branch === "HEAD" ? null : branch;
  } catch {
    return null;
  }
}

async function getTrackingMetadata(
  git: GitClient,
  branch: string | null,
): Promise<GitTrackingMetadata> {
  if (!branch) {
    return {
      upstreamRemote: null,
      upstreamMergeRef: null,
      remoteUrl: null,
    };
  }

  const upstreamRemote = await getGitConfigValue(
    git,
    `branch.${branch}.remote`,
  );
  const upstreamMergeRef = await getGitConfigValue(
    git,
    `branch.${branch}.merge`,
  );
  const remoteUrl = upstreamRemote
    ? await getRemoteUrl(git, upstreamRemote)
    : null;

  return { upstreamRemote, upstreamMergeRef, remoteUrl };
}

async function getGitConfigValue(
  git: GitClient,
  key: string,
): Promise<string | null> {
  try {
    const value = await git.raw(["config", "--get", key]);
    return value.trim() || null;
  } catch {
    return null;
  }
}

async function getRemoteUrl(
  git: GitClient,
  remote: string,
): Promise<string | null> {
  try {
    const value = await git.remote(["get-url", remote]);
    return typeof value === "string" ? value.trim() || null : null;
  } catch {
    return null;
  }
}

async function resolveUpstreamHead(
  git: GitClient,
  upstreamRemote: string,
  upstreamMergeRef: string,
): Promise<string | null> {
  const upstreamBranch = upstreamMergeRef.replace("refs/heads/", "");
  try {
    return (
      (await git.revparse([`${upstreamRemote}/${upstreamBranch}`])).trim() ||
      null
    );
  } catch {
    return null;
  }
}

function hasTrackingConfig(
  localGitState: HandoffLocalGitState | undefined,
): boolean {
  return !!(localGitState?.upstreamRemote || localGitState?.upstreamMergeRef);
}
