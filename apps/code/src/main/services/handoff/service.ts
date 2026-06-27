import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MAIN_TOKENS } from "@main/di/tokens";
import { logger } from "@main/utils/logger";
import { TypedEventEmitter } from "@main/utils/typed-event-emitter";
import { POSTHOG_NOTIFICATIONS } from "@posthog/agent";
import { HandoffCheckpointTracker } from "@posthog/agent/handoff-checkpoint";
import { PostHogAPIClient } from "@posthog/agent/posthog-api";
import type * as AgentTypes from "@posthog/agent/types";
import {
  type GitHandoffBranchDivergence,
  readHandoffLocalGitState,
} from "@posthog/git/handoff";
import { ResetToDefaultBranchSaga } from "@posthog/git/sagas/branch";
import { StashPushSaga } from "@posthog/git/sagas/stash";
import type { IAppLifecycle } from "@posthog/platform/app-lifecycle";
import type { IDialog } from "@posthog/platform/dialog";
import { inject, injectable } from "inversify";
import type { IRepositoryRepository } from "../../db/repositories/repository-repository";
import type { IWorkspaceRepository } from "../../db/repositories/workspace-repository";
import type { AgentAuthAdapter } from "../agent/auth-adapter";
import type { AgentService } from "../agent/service";
import type { CloudTaskService } from "../cloud-task/service";
import type { GitService } from "../git/service";
import { HandoffSaga, type HandoffSagaDeps } from "./handoff-saga";
import {
  HandoffToCloudSaga,
  type HandoffToCloudSagaDeps,
} from "./handoff-to-cloud-saga";
import {
  type HandoffErrorCode,
  HandoffEvent,
  type HandoffExecuteInput,
  type HandoffExecuteResult,
  type HandoffPreflightInput,
  type HandoffPreflightResult,
  type HandoffServiceEvents,
  type HandoffToCloudExecuteInput,
  type HandoffToCloudExecuteResult,
  type HandoffToCloudPreflightInput,
  type HandoffToCloudPreflightResult,
} from "./schemas";

const log = logger.scope("handoff");
const CONTINUE_DIVERGENCE_BUTTON = 1;
const GITHUB_AUTHORIZATION_REQUIRED_CODE = "github_authorization_required";
const GITHUB_AUTHORIZATION_REQUIRED_MESSAGE =
  "Connect GitHub in your browser, then retry Continue in cloud.";

export function extractHandoffErrorCode(
  message: string | undefined,
): HandoffErrorCode | undefined {
  if (message?.includes(GITHUB_AUTHORIZATION_REQUIRED_CODE)) {
    return GITHUB_AUTHORIZATION_REQUIRED_CODE;
  }
  return undefined;
}

@injectable()
export class HandoffService extends TypedEventEmitter<HandoffServiceEvents> {
  constructor(
    @inject(MAIN_TOKENS.GitService) private readonly gitService: GitService,
    @inject(MAIN_TOKENS.AgentService)
    private readonly agentService: AgentService,
    @inject(MAIN_TOKENS.CloudTaskService)
    private readonly cloudTaskService: CloudTaskService,
    @inject(MAIN_TOKENS.AgentAuthAdapter)
    private readonly agentAuthAdapter: AgentAuthAdapter,
    @inject(MAIN_TOKENS.WorkspaceRepository)
    private readonly workspaceRepo: IWorkspaceRepository,
    @inject(MAIN_TOKENS.RepositoryRepository)
    private readonly repositoryRepo: IRepositoryRepository,
    @inject(MAIN_TOKENS.Dialog)
    private readonly dialog: IDialog,
    @inject(MAIN_TOKENS.AppLifecycle)
    private readonly appLifecycle: IAppLifecycle,
  ) {
    super();
  }

  async preflight(
    input: HandoffPreflightInput,
  ): Promise<HandoffPreflightResult> {
    const { repoPath } = input;

    let localTreeDirty = false;
    let localGitState: AgentTypes.HandoffLocalGitState | undefined;
    let changedFileDetails: HandoffPreflightResult["changedFiles"];
    try {
      const changedFiles = await this.gitService.getChangedFilesHead(repoPath);
      localTreeDirty = changedFiles.length > 0;
      changedFileDetails = changedFiles.map((f) => ({
        path: f.path,
        status: f.status,
        linesAdded: f.linesAdded,
        linesRemoved: f.linesRemoved,
      }));
      localGitState = await this.getLocalGitState(repoPath);
    } catch (err) {
      log.warn("Failed to check local working tree", { repoPath, err });
    }

    const canHandoff = !localTreeDirty;
    const reason = localTreeDirty
      ? "Local working tree has uncommitted changes. Commit or stash them first."
      : undefined;

    return {
      canHandoff,
      reason,
      localTreeDirty,
      localGitState,
      changedFiles: changedFileDetails,
    };
  }

  async execute(input: HandoffExecuteInput): Promise<HandoffExecuteResult> {
    const deps: HandoffSagaDeps = {
      createApiClient: (apiHost, teamId) =>
        this.createApiClient(apiHost, teamId),

      applyGitCheckpoint: async (
        checkpoint: AgentTypes.GitCheckpointEvent,
        repoPath: string,
        taskId: string,
        runId: string,
        apiClient: PostHogAPIClient,
        localGitState?: AgentTypes.HandoffLocalGitState,
      ) => {
        const tracker = new HandoffCheckpointTracker({
          repositoryPath: repoPath,
          taskId,
          runId,
          apiClient,
        });
        await tracker.applyFromHandoff(checkpoint, {
          localGitState,
          onDivergedBranch: (divergence) =>
            this.confirmDivergedBranchReset(divergence),
        });
      },

      closeCloudRun: async (taskId, runId, apiHost, teamId, localGitState) => {
        const result = await this.cloudTaskService.sendCommand({
          taskId,
          runId,
          apiHost,
          teamId,
          method: "close",
          params: localGitState ? { localGitState } : undefined,
        });
        if (!result.success) {
          log.warn("Close command failed, continuing with handoff", {
            error: result.error,
          });
        }
      },

      updateWorkspaceMode: (taskId, mode) => {
        this.workspaceRepo.updateMode(taskId, mode);
      },

      attachWorkspaceToFolder: (taskId, repoPath) => {
        const repository = this.repositoryRepo.findByPath(repoPath);
        if (!repository) {
          throw new Error(
            `No registered folder for path '${repoPath}' — cannot attach workspace`,
          );
        }
        const previous = this.workspaceRepo.findByTaskId(taskId);
        if (!previous) {
          throw new Error(`No workspace exists for task ${taskId}`);
        }
        if (
          previous.mode === "local" &&
          previous.repositoryId === repository.id
        ) {
          return { revert: () => {} };
        }
        this.workspaceRepo.setModeAndRepository(taskId, "local", repository.id);
        return {
          revert: () => {
            this.workspaceRepo.setModeAndRepository(
              taskId,
              previous.mode,
              previous.repositoryId,
            );
          },
        };
      },

      seedLocalLogs: async (runId: string, logUrl: string) => {
        let response: Response;
        try {
          response = await fetch(logUrl);
        } catch (err) {
          log.warn("Failed to fetch cloud logs for seeding (network error)", {
            runId,
            err: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        if (!response.ok) {
          log.warn("Failed to fetch cloud logs for seeding", {
            status: response.status,
          });
          return;
        }
        const content = await response.text();
        if (!content?.trim()) return;

        const logDir = join(homedir(), ".posthog-code", "sessions", runId);
        mkdirSync(logDir, { recursive: true });
        const marker = JSON.stringify({ type: "seed_boundary" });
        const trailingNewline = content.endsWith("\n") ? "" : "\n";
        writeFileSync(
          join(logDir, "logs.ndjson"),
          `${content}${trailingNewline}${marker}\n`,
        );
        log.info("Seeded local logs from cloud", {
          runId,
          bytes: content.length,
        });
      },

      reconnectSession: async (params) => {
        return this.agentService.reconnectSession(params);
      },

      killSession: async (taskRunId: string) => {
        await this.agentService.cancelSession(taskRunId);
      },

      syncCloudCheckpoints: async (
        taskId: string,
        runId: string,
        repoPath: string,
        apiClient: PostHogAPIClient,
      ) => {
        await this.syncCloudCheckpointsFromLog(
          taskId,
          runId,
          repoPath,
          apiClient,
        );
      },

      setPendingContext: (taskRunId: string, context: string) => {
        this.agentService.setPendingContext(taskRunId, context);
      },

      onProgress: (step, message) => {
        this.emit(HandoffEvent.Progress, {
          taskId: input.taskId,
          step,
          message,
        });
      },
    };

    const saga = new HandoffSaga(deps, log);
    const result = await saga.run(input);

    if (!result.success) {
      log.error("Handoff saga failed", {
        error: result.error,
        failedStep: result.failedStep,
      });
      deps.onProgress("failed", result.error ?? "Handoff failed");
      return {
        success: false,
        error: `Handoff failed at step '${result.failedStep}': ${result.error}`,
      };
    }

    return {
      success: true,
      sessionId: result.data.sessionId,
    };
  }

  async preflightToCloud(
    input: HandoffToCloudPreflightInput,
  ): Promise<HandoffToCloudPreflightResult> {
    const { repoPath } = input;

    let localGitState: AgentTypes.HandoffLocalGitState | undefined;
    try {
      localGitState = await this.getLocalGitState(repoPath);
    } catch (err) {
      log.warn("Failed to read local git state for cloud handoff", {
        repoPath,
        err,
      });
    }

    return { canHandoff: true, localGitState };
  }

  async executeToCloud(
    input: HandoffToCloudExecuteInput,
  ): Promise<HandoffToCloudExecuteResult> {
    const { taskId, runId, repoPath, apiHost, teamId } = input;
    const apiClient = this.createApiClient(apiHost, teamId);

    const checkpointTracker = new HandoffCheckpointTracker({
      repositoryPath: repoPath,
      taskId,
      runId,
      apiClient,
    });

    const appendNotification = async (
      method: string,
      params: Record<string, unknown>,
    ) => {
      await apiClient.appendTaskRunLog(taskId, runId, [
        {
          type: "notification",
          timestamp: new Date().toISOString(),
          notification: { jsonrpc: "2.0", method, params },
        },
      ]);
    };

    const deps: HandoffToCloudSagaDeps = {
      createApiClient: () => apiClient,

      captureGitCheckpoint: async (localGitState) => {
        const checkpoint =
          await checkpointTracker.captureForHandoff(localGitState);
        if (!checkpoint) return null;
        return { ...checkpoint, device: { type: "local" as const } };
      },

      persistCheckpointToLog: (checkpoint) =>
        appendNotification(
          POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT,
          checkpoint as unknown as Record<string, unknown>,
        ),

      uploadPriorLocalCheckpoints: async (currentCheckpoint, baseline) => {
        const currentId = currentCheckpoint?.checkpointId ?? null;
        const entries = this.agentService.getCheckpointEntries(runId);
        const priorIds = entries
          .map((e) => e.checkpointId)
          .filter((id) => id !== currentId);

        if (priorIds.length === 0) {
          log.debug("No prior local checkpoints to upload", { runId });
          return;
        }

        log.info("Uploading prior local checkpoints to cloud log", {
          runId,
          count: priorIds.length,
        });

        const checkpoints =
          await checkpointTracker.packAndUploadLocalCheckpoints(
            priorIds,
            baseline,
          );

        for (const cp of checkpoints) {
          const entry = entries.find((e) => e.checkpointId === cp.checkpointId);
          await appendNotification(POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT, {
            ...(cp as unknown as Record<string, unknown>),
            device: { type: "local" },
            promptId: entry?.promptId ?? undefined,
          });
        }

        log.info("Prior local checkpoints uploaded to cloud log", {
          runId,
          uploaded: checkpoints.length,
        });
      },

      countLocalLogEntries: (taskRunId) => {
        const logPath = join(
          homedir(),
          ".posthog-code",
          "sessions",
          taskRunId,
          "logs.ndjson",
        );
        if (!existsSync(logPath)) return 0;
        return readFileSync(logPath, "utf-8")
          .split("\n")
          .filter((l) => l.trim()).length;
      },

      resumeRunInCloud: async () => {
        await apiClient.resumeRunInCloud(taskId, runId);
      },

      killSession: async (taskRunId) => {
        await this.agentService.cancelSession(taskRunId);
      },

      updateWorkspaceMode: (tid, mode) => {
        this.workspaceRepo.updateMode(tid, mode);
      },

      onProgress: (step, message) => {
        this.emit(HandoffEvent.Progress, { taskId, step, message });
      },
    };

    const saga = new HandoffToCloudSaga(deps, log);
    const result = await saga.run(input);

    if (!result.success) {
      log.error("Handoff to cloud saga failed", {
        error: result.error,
        failedStep: result.failedStep,
      });
      deps.onProgress("failed", result.error ?? "Handoff to cloud failed");
      const code = extractHandoffErrorCode(result.error);
      return {
        success: false,
        code,
        error:
          code === GITHUB_AUTHORIZATION_REQUIRED_CODE
            ? GITHUB_AUTHORIZATION_REQUIRED_MESSAGE
            : `Handoff to cloud failed at step '${result.failedStep}': ${result.error}`,
      };
    }

    await this.cleanupLocalAfterCloudHandoff(
      repoPath,
      input.localGitState?.branch ?? null,
    );

    this.deleteLocalLogCache(runId);

    return {
      success: true,
      logEntryCount: result.data.logEntryCount,
    };
  }

  private deleteLocalLogCache(runId: string): void {
    const logPath = join(
      homedir(),
      ".posthog-code",
      "sessions",
      runId,
      "logs.ndjson",
    );
    try {
      rmSync(logPath, { force: true });
    } catch (err) {
      log.warn("Failed to delete local log cache after cloud handoff", {
        runId,
        err,
      });
    }
  }

  private async cleanupLocalAfterCloudHandoff(
    repoPath: string,
    branchName: string | null,
  ): Promise<void> {
    try {
      const hasChanges =
        (await this.gitService.getChangedFilesHead(repoPath)).length > 0;

      if (hasChanges) {
        const label = branchName ?? "unknown";
        const stashSaga = new StashPushSaga();
        const stashResult = await stashSaga.run({
          baseDir: repoPath,
          message: `posthog-code: handoff backup (${label})`,
        });
        if (!stashResult.success) {
          log.warn("Failed to stash changes during cloud handoff cleanup", {
            error: stashResult.error,
          });
          return;
        }
      }

      const resetSaga = new ResetToDefaultBranchSaga();
      const resetResult = await resetSaga.run({ baseDir: repoPath });
      if (!resetResult.success) {
        log.warn(
          "Failed to reset to default branch during cloud handoff cleanup",
          {
            error: resetResult.error,
          },
        );
        return;
      }

      log.info("Local cleanup after cloud handoff complete", {
        repoPath,
        switched: resetResult.data.switched,
        defaultBranch: resetResult.data.defaultBranch,
      });
    } catch (err) {
      log.warn("Post-handoff local cleanup failed", { repoPath, err });
    }
  }

  private createApiClient(apiHost: string, teamId: number): PostHogAPIClient {
    const config = this.agentAuthAdapter.createPosthogConfig({
      apiHost,
      projectId: teamId,
    });
    return new PostHogAPIClient(config);
  }

  private async getLocalGitState(
    repoPath: string,
  ): Promise<AgentTypes.HandoffLocalGitState> {
    return readHandoffLocalGitState(repoPath);
  }

  private async confirmDivergedBranchReset(
    divergence: GitHandoffBranchDivergence,
  ): Promise<boolean> {
    await this.appLifecycle.whenReady();

    const response = await this.dialog.confirm({
      severity: "warning",
      options: ["Cancel", "Continue"],
      defaultIndex: 0,
      cancelIndex: 0,
      title: "Local branch has diverged",
      message: `The local branch '${divergence.branch}' has commits that are not in the cloud handoff.`,
      detail:
        `Continuing will reset '${divergence.branch}' from ${divergence.localHead.slice(0, 7)} to ${divergence.cloudHead.slice(0, 7)}.\n\n` +
        "Cancel if you want to keep the current local branch tip.",
    });
    return response === CONTINUE_DIVERGENCE_BUTTON;
  }

  /**
   * After cloud→local handoff's seedLocalLogs step, parse the seeded logs.ndjson
   * for ALL _posthog/git_checkpoint notifications (not just the latest), apply each
   * checkpoint pack from S3 to the local git repo, and register them in the local
   * agentService so every cloud turn shows an enabled restore button.
   *
   * Non-fatal: failures are logged but don't abort the handoff.
   */
  private async syncCloudCheckpointsFromLog(
    taskId: string,
    runId: string,
    repoPath: string,
    apiClient: PostHogAPIClient,
  ): Promise<void> {
    const logPath = join(
      homedir(),
      ".posthog-code",
      "sessions",
      runId,
      "logs.ndjson",
    );

    // [DIAGNOSTIC — task #23] Persist a per-checkpoint sync report to disk. The dev
    // build keeps no on-disk main-process log and main→renderer forwarding is lossy,
    // so this file is the reliable way to learn WHY cloud checkpoint refs don't get
    // applied locally (no artifactPath vs apply-failure vs sync-not-running). Remove
    // with the rest of the debug instrumentation (task #19).
    const debug: {
      runId: string;
      ts: string;
      seededLogFound: boolean;
      source: string;
      markers: Array<{
        checkpointId: string;
        device: unknown;
        hasArtifactPath: boolean;
        hasIndexArtifactPath: boolean;
      }>;
      applied: Array<{
        checkpointId: string;
        ok: boolean;
        created?: boolean;
        error?: string;
      }>;
    } = {
      runId,
      ts: new Date().toISOString(),
      seededLogFound: false,
      source: "none",
      markers: [],
      applied: [],
    };
    const writeDebug = () => {
      try {
        writeFileSync(
          join(homedir(), ".posthog-code", "sessions", runId, "cloud-sync-debug.json"),
          JSON.stringify(debug, null, 2),
        );
      } catch {
        // best-effort
      }
    };

    // Gather raw log entries. Prefer the local seeded cache, but FALL BACK to
    // fetching the run log authoritatively from S3. The seed_local_logs step can
    // be skipped (no cloudLogUrl) or not yet flushed when this runs — observed:
    // seededLogFound=false — and depending on the local file alone silently drops
    // every cloud checkpoint ref, so a later restore fails with "Checkpoint not
    // found". The saga already proves the log is fetchable (resumeFromLog).
    type RawEntry = {
      notification?: { method?: string; params?: Record<string, unknown> };
    };
    let entries: RawEntry[] = [];
    try {
      const content = readFileSync(logPath, "utf-8");
      debug.seededLogFound = true;
      entries = content
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          try {
            return JSON.parse(l) as RawEntry;
          } catch {
            return {} as RawEntry;
          }
        });
    } catch {
      debug.seededLogFound = false;
    }

    const hasCloudMarker = (es: RawEntry[]): boolean =>
      es.some(
        (e) =>
          e.notification?.method === POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT &&
          Boolean(e.notification?.params?.artifactPath),
      );

    if (hasCloudMarker(entries)) {
      debug.source = "local-cache";
    } else {
      // Local cache missing or carries no uploaded cloud checkpoints — fetch the
      // authoritative S3 run log instead.
      try {
        const taskRun = await apiClient.getTaskRun(taskId, runId);
        const fetched = (await apiClient.fetchTaskRunLogs(
          taskRun,
        )) as unknown as RawEntry[];
        if (fetched.length > 0) {
          entries = fetched;
          debug.source = "s3-fetch";
        }
      } catch (err) {
        log.warn("Failed to fetch run log for cloud checkpoint sync", {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const checkpointEvents: AgentTypes.GitCheckpointEvent[] = [];
    for (const entry of entries) {
      if (entry.notification?.method !== POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT) {
        continue;
      }
      const params = entry.notification.params;
      if (params?.checkpointId) {
        // [DIAGNOSTIC] record EVERY checkpoint marker, even those without an
        // artifactPath, so we can tell whether the cloud agent uploaded packs.
        debug.markers.push({
          checkpointId: String(params.checkpointId),
          device: params.device,
          hasArtifactPath: Boolean(params.artifactPath),
          hasIndexArtifactPath: Boolean(params.indexArtifactPath),
        });
      }
      // Only process events that have S3 artifact paths (cloud captures) and
      // that weren't already applied by the main apply_git_checkpoint step.
      if (params?.checkpointId && params?.artifactPath) {
        checkpointEvents.push(
          params as unknown as AgentTypes.GitCheckpointEvent,
        );
      }
    }

    log.info("Syncing cloud checkpoints", {
      runId,
      source: debug.source,
      count: checkpointEvents.length,
    });

    if (checkpointEvents.length === 0) {
      writeDebug();
      return;
    }

    const tracker = new HandoffCheckpointTracker({
      repositoryPath: repoPath,
      taskId,
      runId,
      apiClient,
    });

    for (const event of checkpointEvents) {
      const checkpointId = event.checkpointId;
      try {
        // Recreate the checkpoint git ref so RevertCheckpointSaga can resolve it. This is
        // non-destructive (unpacks objects + rebuilds the ref, no working-tree mutation):
        // the caller's apply_git_checkpoint step already set the final working-tree state,
        // so the sync pass only needs to materialize refs. (applyFromHandoff, used before,
        // never created the ref — it only unpacked objects + reset the tree — so cloud-origin
        // restores failed with "Checkpoint not found".)
        const { created } = await tracker.materializeCheckpointRef(event, {
          localGitState: undefined,
        });

        // Register in agentService so the restore button appears immediately.
        this.agentService.registerCloudCheckpoint(runId, {
          checkpointId,
          promptId:
            typeof event.promptId === "number" ? event.promptId : undefined,
          ts: event.timestamp
            ? new Date(event.timestamp).getTime()
            : Date.now(),
        });

        debug.applied.push({ checkpointId, ok: true, created });
        log.info("Synced cloud checkpoint to local session", {
          runId,
          checkpointId,
          promptId: event.promptId,
          created,
        });
      } catch (err) {
        debug.applied.push({
          checkpointId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        log.warn("Failed to sync cloud checkpoint (non-fatal)", {
          runId,
          checkpointId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    writeDebug();
    log.info("Cloud checkpoint sync complete", {
      runId,
      synced: checkpointEvents.length,
    });
  }
}
