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
        const response = await fetch(logUrl);
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
}
