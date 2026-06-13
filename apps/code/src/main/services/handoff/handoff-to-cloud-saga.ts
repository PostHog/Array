import type * as AgentTypes from "@posthog/agent/types";
import { Saga, type SagaLogger } from "@posthog/shared";
import type { HandoffBaseDeps, HandoffToCloudExecuteInput } from "./schemas";

export type HandoffToCloudSagaInput = HandoffToCloudExecuteInput;

export interface HandoffToCloudSagaOutput {
  checkpointCaptured: boolean;
  logEntryCount: number;
}

export interface HandoffToCloudSagaDeps extends HandoffBaseDeps {
  captureGitCheckpoint(
    localGitState?: AgentTypes.HandoffLocalGitState,
  ): Promise<AgentTypes.GitCheckpointEvent | null>;
  persistCheckpointToLog(
    checkpoint: AgentTypes.GitCheckpointEvent,
  ): Promise<void>;
  /**
   * Packs all prior local checkpoints (excluding the one just captured) and
   * appends them to the cloud run log, so they survive after cloud→local handoff.
   */
  uploadPriorLocalCheckpoints(
    currentCheckpoint: AgentTypes.GitCheckpointEvent | null,
    baseline?: string | null,
  ): Promise<void>;
  countLocalLogEntries(runId: string): number;
  resumeRunInCloud(): Promise<void>;
}

export class HandoffToCloudSaga extends Saga<
  HandoffToCloudSagaInput,
  HandoffToCloudSagaOutput
> {
  readonly sagaName = "HandoffToCloudSaga";
  private deps: HandoffToCloudSagaDeps;

  constructor(deps: HandoffToCloudSagaDeps, logger?: SagaLogger) {
    super(logger);
    this.deps = deps;
  }

  protected async execute(
    input: HandoffToCloudSagaInput,
  ): Promise<HandoffToCloudSagaOutput> {
    const { taskId, runId } = input;

    let checkpointCaptured = false;

    this.deps.onProgress(
      "capturing_checkpoint",
      "Capturing local git state...",
    );

    const checkpoint = await this.readOnlyStep("capture_git_checkpoint", () =>
      this.deps.captureGitCheckpoint(input.localGitState),
    );

    if (checkpoint) {
      await this.readOnlyStep("persist_checkpoint_to_log", () =>
        this.deps.persistCheckpointToLog(checkpoint),
      );
      checkpointCaptured = true;
    }

    // Upload all prior local turn checkpoints to S3 and append them to the
    // cloud run log so they're available after any future cloud→local handoff.
    await this.readOnlyStep("upload_prior_local_checkpoints", () =>
      this.deps.uploadPriorLocalCheckpoints(
        checkpoint,
        input.localGitState?.upstreamHead ?? null,
      ),
    );

    this.deps.onProgress("starting_cloud_run", "Starting cloud sandbox...");

    await this.step({
      name: "start_cloud_run",
      execute: () => this.deps.resumeRunInCloud(),
      rollback: async () => {},
    });

    this.deps.onProgress("stopping_agent", "Stopping local agent...");

    await this.readOnlyStep("stop_local_agent", () =>
      this.deps.killSession(runId),
    );

    const logEntryCount = this.deps.countLocalLogEntries(runId);

    await this.step({
      name: "update_workspace",
      execute: async () => {
        this.deps.updateWorkspaceMode(taskId, "cloud");
      },
      rollback: async () => {
        this.deps.updateWorkspaceMode(taskId, "local");
      },
    });

    this.deps.onProgress("complete", "Handoff to cloud complete");

    return { checkpointCaptured, logEntryCount };
  }
}
