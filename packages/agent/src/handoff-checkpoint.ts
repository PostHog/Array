import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type GitHandoffBranchDivergence,
  type GitHandoffCheckpoint,
  GitHandoffTracker,
} from "@posthog/git/handoff";
import type {
  PostHogAPIClient,
  PreparedTaskArtifactUpload,
} from "./posthog-api";
import type {
  GitCheckpoint,
  GitCheckpointEvent,
  HandoffLocalGitState,
  RepositoryGitCheckpoint,
} from "./types";
import { Logger } from "./utils/logger";

/** Server-side cap on a single task-run artifact; larger files are skipped, not failed. */
const MAX_ARTIFACT_UPLOAD_BYTES = 30 * 1024 * 1024;
/** Inline uploads travel base64-encoded inside a JSON API body, so they must stay well under API request size limits. */
const MAX_INLINE_UPLOAD_BYTES = 10 * 1024 * 1024;

const PACK_MAGIC = Buffer.from("PACK");
const INDEX_MAGIC = Buffer.from("DIRC");
const execFileAsync = promisify(execFile);
const IGNORED_WORKSPACE_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".pnpm-store",
  ".venv",
  "venv",
]);
const MAX_WORKSPACE_REPOSITORIES = 50;

/**
 * Handoff artifacts used to be stored as base64 text (inline uploads without
 * content_encoding); direct-to-storage uploads store raw bytes. Detect raw
 * git payloads by their magic bytes and fall back to the legacy base64
 * decode otherwise.
 */
export function decodeHandoffArtifact(buffer: Buffer): Buffer {
  const head = buffer.subarray(0, 4);
  if (head.equals(PACK_MAGIC) || head.equals(INDEX_MAGIC)) {
    return buffer;
  }
  const text = buffer.toString("utf-8");
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    return Buffer.from(text, "base64");
  }
  return buffer;
}

export interface HandoffCheckpointTrackerConfig {
  repositoryPath: string;
  taskId: string;
  runId: string;
  apiClient?: PostHogAPIClient;
  logger?: Logger;
}

type ArtifactTransfer<T extends object = Record<string, never>> = T & {
  rawBytes: number;
  wireBytes: number;
};

type UploadedArtifact = ArtifactTransfer<{ storagePath?: string }>;
type DownloadedArtifact = ArtifactTransfer<{ filePath: string }>;

type ArtifactKey = "pack" | "index";
type ArtifactSlotMap<T extends object> = Partial<
  Record<ArtifactKey, ArtifactTransfer<T>>
>;

interface UploadArtifactSpec {
  key: ArtifactKey;
  filePath?: string;
  name: string;
  contentType: string;
}

interface DownloadArtifactSpec {
  key: ArtifactKey;
  storagePath?: string;
  filePath: string;
  label: string;
}

type Uploads = ArtifactSlotMap<{ storagePath?: string }>;
type Downloads = ArtifactSlotMap<{ filePath: string }>;

export class HandoffCheckpointTracker {
  private repositoryPath: string;
  private taskId: string;
  private runId: string;
  private apiClient?: PostHogAPIClient;
  private logger: Logger;

  constructor(config: HandoffCheckpointTrackerConfig) {
    this.repositoryPath = config.repositoryPath;
    this.taskId = config.taskId;
    this.runId = config.runId;
    this.apiClient = config.apiClient;
    this.logger =
      config.logger ||
      new Logger({ debug: false, prefix: "[HandoffCheckpointTracker]" });
  }

  async captureForHandoff(
    localGitState?: HandoffLocalGitState,
    options?: { durableDefaultBranchBaseline?: boolean },
  ): Promise<GitCheckpoint | null> {
    if (!this.apiClient) {
      throw new Error(
        "Cannot capture handoff checkpoint: API client not configured",
      );
    }

    const gitTracker = this.createGitTracker();
    const capture = await gitTracker.captureForHandoff(localGitState, options);

    try {
      const uploads = await this.uploadArtifacts([
        {
          key: "pack",
          filePath: capture.headPack?.path,
          name: `handoff/${capture.checkpoint.checkpointId}.pack`,
          contentType: "application/x-git-packed-objects",
        },
        {
          key: "index",
          filePath: capture.indexFile.path,
          name: `handoff/${capture.checkpoint.checkpointId}.index`,
          contentType: "application/octet-stream",
        },
      ]);

      // A checkpoint that references artifacts which never made it to storage
      // would make resume apply an incomplete git state; drop it instead.
      const packUploadMissing =
        !!capture.headPack && !uploads.pack?.storagePath;
      const indexUploadMissing = !uploads.index?.storagePath;
      if (packUploadMissing || indexUploadMissing) {
        this.logger.debug(
          "Discarding handoff checkpoint: required artifact uploads did not complete",
          {
            checkpointId: capture.checkpoint.checkpointId,
            packUploadMissing,
            indexUploadMissing,
            packBytes: capture.headPack?.rawBytes ?? 0,
            indexBytes: capture.indexFile.rawBytes,
          },
        );
        return null;
      }

      this.logCaptureMetrics(capture.checkpoint, uploads);

      return {
        ...capture.checkpoint,
        artifactPath: uploads.pack?.storagePath,
        indexArtifactPath: uploads.index?.storagePath,
      };
    } finally {
      await rm(capture.artifactDirectory, {
        recursive: true,
        force: true,
      }).catch(() => {});
    }
  }

  /**
   * Capture every Git repository below a workspace root. The legacy top-level
   * checkpoint remains the primary repository so older agents can still resume.
   */
  async captureWorkspaceForHandoff(
    workspacePath: string,
    localGitState?: HandoffLocalGitState,
  ): Promise<GitCheckpointEvent | null> {
    const workspaceRoot = resolve(workspacePath);
    const primaryPath = resolve(this.repositoryPath);
    const repositoryPaths = await discoverGitRepositories(workspaceRoot);
    if (!repositoryPaths.includes(primaryPath)) {
      repositoryPaths.unshift(primaryPath);
    }

    const repositories: RepositoryGitCheckpoint[] = [];
    const incompleteRepositories: string[] = [];
    for (const repositoryPath of repositoryPaths) {
      const relativePath = safeRelativeRepositoryPath(
        workspaceRoot,
        repositoryPath,
      );
      if (relativePath === null) {
        this.logger.warn("Skipping checkpoint outside workspace", {
          workspaceRoot,
          repositoryPath,
        });
        continue;
      }
      const primary = repositoryPath === primaryPath;
      try {
        const tracker = new HandoffCheckpointTracker({
          repositoryPath,
          taskId: this.taskId,
          runId: this.runId,
          apiClient: this.apiClient,
          logger: this.logger,
        });
        const checkpoint = await tracker.captureForHandoff(
          primary ? localGitState : undefined,
          { durableDefaultBranchBaseline: true },
        );
        if (checkpoint) {
          repositories.push({ ...checkpoint, path: relativePath, primary });
        } else {
          incompleteRepositories.push(relativePath);
        }
      } catch (error) {
        this.logger.warn("Failed to capture repository checkpoint", {
          repositoryPath,
          primary,
          error: error instanceof Error ? error.message : String(error),
        });
        if (primary) throw error;
        incompleteRepositories.push(relativePath);
      }
    }

    const primary = repositories.find((repository) => repository.primary);
    if (!primary) return null;
    return {
      ...primary,
      manifestVersion: 1,
      repositories,
      incompleteRepositories:
        incompleteRepositories.length > 0 ? incompleteRepositories : undefined,
    };
  }

  async applyFromHandoff(
    checkpoint: GitCheckpoint,
    options?: {
      localGitState?: HandoffLocalGitState;
      skipUpstreamBaselineFetch?: boolean;
      onDivergedBranch?: (
        divergence: GitHandoffBranchDivergence,
      ) => Promise<boolean>;
    },
  ): Promise<{ packBytes: number; indexBytes: number; totalBytes: number }> {
    if (!this.apiClient) {
      throw new Error(
        "Cannot apply handoff checkpoint: API client not configured",
      );
    }

    const gitTracker = this.createGitTracker();
    const tmpDir = await mkdtemp(
      join(tmpdir(), `posthog-code-handoff-${checkpoint.checkpointId}-`),
    );

    const packPath = join(tmpDir, `${checkpoint.checkpointId}.pack`);
    const indexPath = join(tmpDir, `${checkpoint.checkpointId}.index`);

    try {
      const downloads = await this.downloadArtifacts([
        {
          key: "pack",
          storagePath: checkpoint.artifactPath,
          filePath: packPath,
          label: "handoff pack",
        },
        {
          key: "index",
          storagePath: checkpoint.indexArtifactPath,
          filePath: indexPath,
          label: "handoff index",
        },
      ]);

      const applyResult = await gitTracker.applyFromHandoff({
        checkpoint: this.toGitCheckpoint(checkpoint),
        headPackPath: downloads.pack?.filePath,
        indexPath: downloads.index?.filePath,
        localGitState: options?.localGitState,
        skipUpstreamBaselineFetch: options?.skipUpstreamBaselineFetch,
        onDivergedBranch: options?.onDivergedBranch,
      });

      this.logApplyMetrics(checkpoint, downloads, applyResult.totalBytes);

      return {
        packBytes: downloads.pack?.rawBytes ?? 0,
        indexBytes: downloads.index?.rawBytes ?? 0,
        totalBytes: applyResult.totalBytes,
      };
    } finally {
      await this.removeIfPresent(packPath);
      await this.removeIfPresent(indexPath);
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Restore a multi-repository event, cloning missing sibling repositories. */
  async applyWorkspaceFromHandoff(
    event: GitCheckpointEvent,
    workspacePath: string,
  ): Promise<{
    repositories: number;
    failedRepositories: number;
    totalBytes: number;
  }> {
    if (!event.repositories?.length) {
      const metrics = await this.applyFromHandoff(event);
      return {
        repositories: 1,
        failedRepositories: 0,
        totalBytes: metrics.totalBytes,
      };
    }

    const workspaceRoot = resolve(workspacePath);
    let totalBytes = 0;
    let restored = 0;
    let failed = event.incompleteRepositories?.length ?? 0;
    const ordered = [...event.repositories].sort(
      (left, right) => Number(right.primary) - Number(left.primary),
    );
    for (const repository of ordered) {
      const repositoryPath = resolveRepositoryPath(
        workspaceRoot,
        repository.path,
      );
      if (
        repository.primary &&
        repositoryPath !== resolve(this.repositoryPath)
      ) {
        throw new Error(
          "Checkpoint primary repository path does not match task repository",
        );
      }
      const tracker = new HandoffCheckpointTracker({
        repositoryPath,
        taskId: this.taskId,
        runId: this.runId,
        apiClient: this.apiClient,
        logger: this.logger,
      });
      try {
        await ensureGitRepository(repositoryPath, repository.remoteUrl);
        const metrics = await tracker.applyFromHandoff(repository, {
          skipUpstreamBaselineFetch: true,
        });
        totalBytes += metrics.totalBytes;
        restored += 1;
      } catch (error) {
        this.logger.warn("Failed to restore repository checkpoint", {
          repositoryPath,
          primary: repository.primary,
          error: error instanceof Error ? error.message : String(error),
        });
        if (repository.primary) throw error;
        failed += 1;
      }
    }
    return {
      repositories: restored,
      failedRepositories: failed,
      totalBytes,
    };
  }

  private toGitCheckpoint(checkpoint: GitCheckpoint): GitHandoffCheckpoint {
    return {
      checkpointId: checkpoint.checkpointId,
      commit: checkpoint.commit,
      checkpointRef: checkpoint.checkpointRef,
      headRef: checkpoint.headRef,
      head: checkpoint.head,
      branch: checkpoint.branch,
      indexTree: checkpoint.indexTree,
      worktreeTree: checkpoint.worktreeTree,
      timestamp: checkpoint.timestamp,
      upstreamRemote: checkpoint.upstreamRemote ?? null,
      upstreamMergeRef: checkpoint.upstreamMergeRef ?? null,
      remoteUrl: checkpoint.remoteUrl ?? null,
    };
  }

  private async uploadArtifactFile(
    filePath: string,
    name: string,
    contentType: string,
  ): Promise<UploadedArtifact> {
    if (!this.apiClient) {
      return { rawBytes: 0, wireBytes: 0 };
    }

    const content = await readFile(filePath);
    if (content.byteLength > MAX_ARTIFACT_UPLOAD_BYTES) {
      this.logger.debug(
        "Skipping handoff artifact upload: file exceeds the artifact size limit",
        {
          name,
          rawBytes: content.byteLength,
          maxBytes: MAX_ARTIFACT_UPLOAD_BYTES,
        },
      );
      return { rawBytes: content.byteLength, wireBytes: 0 };
    }

    try {
      const storagePath = await this.uploadArtifactDirect(
        content,
        name,
        contentType,
      );
      if (storagePath) {
        return {
          storagePath,
          rawBytes: content.byteLength,
          wireBytes: content.byteLength,
        };
      }
    } catch (error) {
      this.logger.warn(
        "Direct artifact upload failed; falling back to inline upload",
        { name, error: error instanceof Error ? error.message : String(error) },
      );
    }

    return this.uploadArtifactInline(content, name, contentType);
  }

  private async uploadArtifactDirect(
    content: Buffer,
    name: string,
    contentType: string,
  ): Promise<string | undefined> {
    if (!this.apiClient) {
      return undefined;
    }

    const [prepared] = await this.apiClient.prepareTaskArtifactUploads(
      this.taskId,
      this.runId,
      [
        {
          name,
          type: "artifact",
          size: content.byteLength,
          content_type: contentType,
        },
      ],
    );
    if (!prepared) {
      return undefined;
    }

    await this.postToPresignedUrl(prepared, content, contentType);

    const [finalized] = await this.apiClient.finalizeTaskArtifactUploads(
      this.taskId,
      this.runId,
      [
        {
          id: prepared.id,
          name: prepared.name,
          type: "artifact",
          storage_path: prepared.storage_path,
          content_type: contentType,
        },
      ],
    );
    // An unconfirmed finalize means the artifact was never attached to the
    // run manifest; referencing it would break the download on resume.
    if (!finalized?.storage_path) {
      throw new Error(
        `Artifact finalize did not confirm ${name} at ${prepared.storage_path}`,
      );
    }
    return finalized.storage_path;
  }

  private async postToPresignedUrl(
    prepared: PreparedTaskArtifactUpload,
    content: Buffer,
    contentType: string,
  ): Promise<void> {
    const form = new FormData();
    for (const [key, value] of Object.entries(prepared.presigned_post.fields)) {
      form.append(key, value);
    }
    form.append(
      "file",
      new Blob([new Uint8Array(content)], { type: contentType }),
      prepared.name,
    );

    const response = await fetch(prepared.presigned_post.url, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      throw new Error(
        `Presigned artifact upload failed: [${response.status}] ${response.statusText}`,
      );
    }
  }

  private async uploadArtifactInline(
    content: Buffer,
    name: string,
    contentType: string,
  ): Promise<UploadedArtifact> {
    if (!this.apiClient) {
      return { rawBytes: content.byteLength, wireBytes: 0 };
    }

    if (content.byteLength > MAX_INLINE_UPLOAD_BYTES) {
      this.logger.warn(
        "Skipping inline handoff artifact upload: file exceeds the inline upload limit",
        {
          name,
          rawBytes: content.byteLength,
          maxBytes: MAX_INLINE_UPLOAD_BYTES,
        },
      );
      return { rawBytes: content.byteLength, wireBytes: 0 };
    }

    const base64Content = content.toString("base64");
    try {
      const artifacts = await this.apiClient.uploadTaskArtifacts(
        this.taskId,
        this.runId,
        [
          {
            name,
            type: "artifact",
            content: base64Content,
            content_encoding: "base64",
            content_type: contentType,
          },
        ],
      );
      return {
        storagePath: artifacts.at(-1)?.storage_path,
        rawBytes: content.byteLength,
        wireBytes: Buffer.byteLength(base64Content, "utf-8"),
      };
    } catch (error) {
      this.logger.warn("Inline handoff artifact upload failed", {
        name,
        rawBytes: content.byteLength,
        error: error instanceof Error ? error.message : String(error),
      });
      return { rawBytes: content.byteLength, wireBytes: 0 };
    }
  }

  private async uploadArtifacts(specs: UploadArtifactSpec[]): Promise<Uploads> {
    const results: Array<readonly [ArtifactKey, UploadedArtifact | undefined]> =
      [];
    for (const spec of specs) {
      if (!spec.filePath) {
        results.push([spec.key, undefined] as const);
        continue;
      }
      results.push([
        spec.key,
        await this.uploadArtifactFile(
          spec.filePath,
          spec.name,
          spec.contentType,
        ),
      ] as const);
    }

    return Object.fromEntries(results) as Uploads;
  }

  private async downloadArtifactToFile(
    artifactPath: string,
    filePath: string,
    label: string,
  ): Promise<DownloadedArtifact> {
    if (!this.apiClient) {
      throw new Error(`Cannot download ${label}: API client not configured`);
    }

    const arrayBuffer = await this.apiClient.downloadArtifact(
      this.taskId,
      this.runId,
      artifactPath,
    );
    if (!arrayBuffer) {
      throw new Error(`Failed to download ${label} from ${artifactPath}`);
    }
    const binaryContent = decodeHandoffArtifact(Buffer.from(arrayBuffer));
    await writeFile(filePath, binaryContent);
    return {
      filePath,
      rawBytes: binaryContent.byteLength,
      wireBytes: arrayBuffer.byteLength,
    };
  }

  private async downloadArtifacts(
    specs: DownloadArtifactSpec[],
  ): Promise<Downloads> {
    const downloads = await Promise.all(
      specs.map(async (spec) => {
        if (!spec.storagePath) {
          return [spec.key, undefined] as const;
        }
        return [
          spec.key,
          await this.downloadArtifactToFile(
            spec.storagePath,
            spec.filePath,
            spec.label,
          ),
        ] as const;
      }),
    );

    return Object.fromEntries(downloads) as Downloads;
  }

  private createGitTracker(): GitHandoffTracker {
    return new GitHandoffTracker({
      repositoryPath: this.repositoryPath,
      logger: this.logger,
    });
  }

  private logCaptureMetrics(
    checkpoint: GitHandoffCheckpoint,
    uploads: Uploads,
  ): void {
    this.logger.debug("Captured handoff checkpoint", {
      branch: checkpoint.branch,
      head: checkpoint.head?.slice(0, 7),
      totalBytes: this.sumRawBytes(uploads.pack, uploads.index),
    });
  }

  private logApplyMetrics(
    checkpoint: GitCheckpoint,
    _downloads: Downloads,
    totalBytes: number,
  ): void {
    this.logger.debug("Applied handoff checkpoint", {
      branch: checkpoint.branch,
      head: checkpoint.head?.slice(0, 7),
      totalBytes,
    });
  }

  private sumRawBytes(
    ...artifacts: Array<{ rawBytes: number } | undefined>
  ): number {
    return artifacts.reduce(
      (total, artifact) => total + (artifact?.rawBytes ?? 0),
      0,
    );
  }

  private async removeIfPresent(filePath: string | undefined): Promise<void> {
    if (!filePath) {
      return;
    }
    await rm(filePath, { force: true }).catch(() => {});
  }
}

export async function discoverGitRepositories(
  workspacePath: string,
): Promise<string[]> {
  const repositories: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (repositories.length >= MAX_WORKSPACE_REPOSITORIES) return;
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.name === ".git")) {
      repositories.push(resolve(directory));
      return;
    }
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.isSymbolicLink() &&
            !IGNORED_WORKSPACE_DIRECTORIES.has(entry.name),
        )
        .map((entry) => visit(join(directory, entry.name))),
    );
  };
  await visit(resolve(workspacePath));
  return repositories.sort();
}

function safeRelativeRepositoryPath(
  workspaceRoot: string,
  repositoryPath: string,
): string | null {
  const value = relative(workspaceRoot, repositoryPath);
  if (!value || value === ".") return ".";
  if (
    isAbsolute(value) ||
    value === ".." ||
    value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    return null;
  }
  return value;
}

function resolveRepositoryPath(workspaceRoot: string, path: string): string {
  if (isAbsolute(path))
    throw new Error("Repository checkpoint path must be relative");
  const resolved = resolve(workspaceRoot, path);
  if (safeRelativeRepositoryPath(workspaceRoot, resolved) === null) {
    throw new Error("Repository checkpoint path escapes workspace");
  }
  return resolved;
}

async function ensureGitRepository(
  repositoryPath: string,
  remoteUrl: string | null | undefined,
): Promise<void> {
  try {
    await access(join(repositoryPath, ".git"));
    return;
  } catch {
    // Restore from the checkpoint after creating a normal Git object store.
  }
  if (!remoteUrl) {
    throw new Error(
      `Cannot restore missing repository without a remote URL: ${repositoryPath}`,
    );
  }
  await mkdir(dirname(repositoryPath), { recursive: true });
  try {
    await access(repositoryPath);
    await execFileAsync("git", ["init", repositoryPath]);
    await execFileAsync("git", ["remote", "add", "origin", remoteUrl], {
      cwd: repositoryPath,
    });
    await execFileAsync("git", ["fetch", "--no-tags", "origin"], {
      cwd: repositoryPath,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    try {
      await access(repositoryPath);
    } catch {
      await execFileAsync(
        "git",
        ["clone", "--no-checkout", remoteUrl, repositoryPath],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      return;
    }
    throw error;
  }
}
