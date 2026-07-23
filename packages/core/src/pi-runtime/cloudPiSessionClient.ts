import {
  getRemotePiConversation,
  type PiRemoteRpcClient,
  RemotePiRpcClient,
} from "@posthog/agent/pi/remote-rpc-client";
import type { RpcCommand } from "@posthog/agent/pi/rpc-transport";
import type {
  AgentConversationEvent,
  PiRuntimeHealth,
  StoredLogEntry,
  TaskRunStatus,
} from "@posthog/shared";
import type { CloudTaskUpdatePayload } from "@posthog/shared/domain-types";
import type { CloudTaskClient } from "../cloud-task/cloudTaskClient";
import {
  isTerminalStatus,
  progressNotificationParams,
} from "../cloud-task/schemas";
import type { PiSession } from "./piSessionController";

function createTerminalPiRpcClient(
  runId: string,
  getRunStatus: () => TaskRunStatus,
): PiRemoteRpcClient {
  const rejectCommand = async (): Promise<never> => {
    throw new Error(`Cloud task run ${runId} is ${getRunStatus()}`);
  };

  return {
    prompt: rejectCommand,
    steer: rejectCommand,
    followUp: rejectCommand,
    abort: rejectCommand,
    getState: async () => ({
      isStreaming: false,
      isCompacting: false,
      thinkingLevel: "off",
      steeringMode: "all",
      followUpMode: "all",
      sessionId: runId,
      autoCompactionEnabled: true,
      messageCount: 0,
      pendingMessageCount: 0,
    }),
    setModel: rejectCommand,
    getAvailableModels: async () => [],
    getAvailableThinkingLevels: async () => [],
    setThinkingLevel: rejectCommand,
    setSteeringMode: rejectCommand,
    setFollowUpMode: rejectCommand,
    compact: rejectCommand,
    bash: rejectCommand,
    abortBash: rejectCommand,
    getEntries: async () => ({ entries: [], leafId: null }),
    getCommands: async () => [],
  };
}

export interface CloudPiSessionContext {
  taskId: string;
  runId: string;
  runStatus: TaskRunStatus;
  apiHost: string;
  teamId: number;
}

export class CloudPiSessionClient implements PiSession {
  private readonly liveClient: PiRemoteRpcClient;
  private readonly terminalClient: PiRemoteRpcClient;
  private runStatus: TaskRunStatus;
  private snapshotEvents: AgentConversationEvent[] = [];
  private resolveSnapshot: () => void = () => {};
  private rejectSnapshot: (error: unknown) => void = () => {};
  private readonly snapshotReceived = new Promise<void>((resolve, reject) => {
    this.resolveSnapshot = resolve;
    this.rejectSnapshot = reject;
  });
  private runtimeReady = false;
  private resolveRuntimeReady: () => void = () => {};
  private readonly runtimeReadyReceived = new Promise<void>((resolve) => {
    this.resolveRuntimeReady = resolve;
  });
  private terminalEventSent = false;
  private resolveTerminalStatus: () => void = () => {};
  private readonly terminalStatusReceived = new Promise<void>((resolve) => {
    this.resolveTerminalStatus = resolve;
  });

  constructor(
    private readonly cloudTaskClient: CloudTaskClient,
    private readonly context: CloudPiSessionContext,
  ) {
    this.runStatus = context.runStatus;
    if (isTerminalStatus(this.runStatus)) {
      this.resolveTerminalStatus();
    }
    void this.snapshotReceived.catch(() => {});
    this.liveClient = new RemotePiRpcClient({
      request: (command) => this.request(command),
    });
    this.terminalClient = createTerminalPiRpcClient(
      context.runId,
      () => this.runStatus,
    );
  }

  get client(): PiRemoteRpcClient {
    return isTerminalStatus(this.runStatus)
      ? this.terminalClient
      : this.liveClient;
  }

  get resumeRequired(): boolean {
    return isTerminalStatus(this.runStatus);
  }

  health(): Promise<PiRuntimeHealth> {
    if (this.runStatus === "in_progress") {
      return Promise.resolve({ state: "streaming" });
    }
    if (isTerminalStatus(this.runStatus)) {
      return Promise.resolve({ state: "cold" });
    }
    return Promise.resolve({ state: "starting" });
  }

  async getConversation(): Promise<AgentConversationEvent[]> {
    if (!isTerminalStatus(this.runStatus)) {
      try {
        const conversation = await getRemotePiConversation(this.liveClient);
        if (!isTerminalStatus(this.runStatus)) {
          return conversation;
        }
      } catch (error) {
        if (!isTerminalStatus(this.runStatus)) {
          throw error;
        }
      }
    }

    await this.snapshotReceived;
    return this.snapshotEvents;
  }

  onConversationEvent(
    onEvent: (event: AgentConversationEvent) => void,
    onError: (error: unknown) => void,
  ): () => void {
    let active = true;
    const unsubscribe = this.cloudTaskClient.subscribe(
      this.context.taskId,
      this.context.runId,
      (update) => this.handleUpdate(update, onEvent, onError),
      (error) => {
        if (isTerminalStatus(this.runStatus)) {
          this.rejectSnapshot(error);
        }
        onError(error);
      },
      () => {
        if (!active) {
          return;
        }

        void this.cloudTaskClient
          .watch({
            taskId: this.context.taskId,
            runId: this.context.runId,
            apiHost: this.context.apiHost,
            teamId: this.context.teamId,
          })
          .catch((error) => {
            if (isTerminalStatus(this.runStatus)) {
              this.rejectSnapshot(error);
            }
            onError(error);
          });
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }

  private handleUpdate(
    update: CloudTaskUpdatePayload,
    onEvent: (event: AgentConversationEvent) => void,
    onError: (error: unknown) => void,
  ): void {
    const snapshotCanProveReadiness =
      update.kind === "snapshot" && this.context.runStatus === "in_progress";
    const hasCurrentReadinessEvent =
      (update.kind === "logs" || snapshotCanProveReadiness) &&
      update.newEntries.some((entry) => entry.type === "pi_run_started");
    if (hasCurrentReadinessEvent) {
      this.markRuntimeReady();
    }

    if (update.kind === "error") {
      const error = new Error(update.errorMessage);
      if (isTerminalStatus(this.runStatus)) {
        this.rejectSnapshot(error);
      }
      onError(error);
      return;
    }

    if (update.kind === "snapshot") {
      const events = this.getConversationEvents(update.newEntries);
      let unchangedEventCount = 0;
      while (
        unchangedEventCount < events.length &&
        unchangedEventCount < this.snapshotEvents.length &&
        this.eventsEqual(
          events[unchangedEventCount],
          this.snapshotEvents[unchangedEventCount],
        )
      ) {
        unchangedEventCount += 1;
      }

      this.snapshotEvents = events;
      this.resolveSnapshot();
      for (const event of events.slice(unchangedEventCount)) {
        onEvent(event);
      }
    } else if (update.kind === "logs") {
      const events = this.getConversationEvents(update.newEntries);
      this.snapshotEvents = [...this.snapshotEvents, ...events];
      for (const event of events) {
        onEvent(event);
      }
    }

    if (
      (update.kind === "snapshot" || update.kind === "status") &&
      update.status
    ) {
      this.runStatus = update.status;
    }

    if (isTerminalStatus(this.runStatus)) {
      this.resolveTerminalStatus();
      if (!this.terminalEventSent) {
        this.terminalEventSent = true;
        onEvent({ type: "turn_completed", timestamp: Date.now() });
      }
    }
  }

  private eventsEqual(
    left: AgentConversationEvent,
    right: AgentConversationEvent,
  ): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private getConversationEvents(
    entries: StoredLogEntry[],
  ): AgentConversationEvent[] {
    const events: AgentConversationEvent[] = [];
    for (const entry of entries) {
      if (entry.type === "pi_event" && entry.event) {
        events.push(entry.event);
        continue;
      }

      const progress = this.getProgressEvent(entry);
      if (progress) {
        events.push(progress);
      }
    }
    return events;
  }

  private getProgressEvent(
    entry: StoredLogEntry,
  ): AgentConversationEvent | null {
    if (
      entry.notification?.method !== "_posthog/progress" &&
      entry.notification?.method !== "__posthog/progress"
    ) {
      return null;
    }

    const params = progressNotificationParams.safeParse(
      entry.notification.params,
    );
    const timestamp = Date.parse(entry.timestamp ?? "");
    if (!params.success || Number.isNaN(timestamp)) {
      return null;
    }

    return {
      type: "progress",
      timestamp,
      ...params.data,
    };
  }

  private async request(command: RpcCommand): Promise<unknown> {
    await this.waitForRuntimeReady();
    if (isTerminalStatus(this.runStatus)) {
      throw new Error(
        `Cloud task run ${this.context.runId} is ${this.runStatus}`,
      );
    }

    const result = await this.cloudTaskClient.sendCommand({
      taskId: this.context.taskId,
      runId: this.context.runId,
      apiHost: this.context.apiHost,
      teamId: this.context.teamId,
      method: "pi/rpc",
      params: { command },
    });
    if (!result.success) {
      throw new Error(result.error ?? `Pi RPC command failed: ${command.type}`);
    }

    return result.result;
  }

  private markRuntimeReady(): void {
    if (this.runtimeReady) {
      return;
    }
    this.runtimeReady = true;
    this.resolveRuntimeReady();
  }

  private async waitForRuntimeReady(): Promise<void> {
    if (this.runtimeReady || isTerminalStatus(this.runStatus)) {
      return;
    }

    await Promise.race([
      this.runtimeReadyReceived,
      this.terminalStatusReceived,
    ]);
  }
}
