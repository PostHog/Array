import type {
  CloudTaskCommandController,
  CloudTaskCommandTarget,
} from "./cloudTaskCommandController";

export interface CloudTaskRunSession {
  taskRunId: string;
  stopRequested?: boolean;
  isPromptPending: boolean;
  promptStartedAt?: number | null;
  activityVersion: string | number;
}

export interface CloudTaskRunStatePort {
  get(taskRunId: string): CloudTaskRunSession | undefined;
  update(
    taskRunId: string,
    patch: {
      stopRequested?: boolean;
      isPromptPending: boolean;
      promptStartedAt?: number | null;
    },
  ): void;
}

export class CloudTaskRunLifecycle {
  constructor(
    private readonly commands: CloudTaskCommandController,
    private readonly state: CloudTaskRunStatePort,
  ) {}

  async stopRun(
    target: CloudTaskCommandTarget,
    session?: CloudTaskRunSession,
  ): Promise<void> {
    if (session) {
      this.state.update(session.taskRunId, {
        stopRequested: true,
        isPromptPending: false,
        promptStartedAt: null,
      });
    }

    try {
      await this.commands.stopRun(target);
    } catch (error) {
      const current = session ? this.state.get(session.taskRunId) : undefined;
      if (
        session &&
        current?.stopRequested === true &&
        current.isPromptPending === false &&
        current.promptStartedAt == null &&
        current.activityVersion === session.activityVersion
      ) {
        this.state.update(session.taskRunId, {
          stopRequested: session.stopRequested,
          isPromptPending: session.isPromptPending,
          promptStartedAt: session.promptStartedAt,
        });
      }
      throw error;
    }
  }
}
