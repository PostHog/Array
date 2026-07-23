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

const readinessCommands = new Set<RpcCommand["type"]>([
  "get_state",
  "get_entries",
  "get_available_models",
  "get_available_thinking_levels",
  "get_commands",
]);

export interface CloudPiSessionContext {
  taskId: string;
  runId: string;
  runStatus: TaskRunStatus;
  apiHost: string;
  teamId: number;
  waitUntilReady?: () => Promise<TaskRunStatus>;
}

export class CloudPiSessionClient implements PiSession {
  readonly client: PiRemoteRpcClient;

  private runStatus: TaskRunStatus;
  private snapshotEvents: AgentConversationEvent[] = [];
  private hasSnapshot = false;
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
    this.client = new RemotePiRpcClient({
      request: (command) => this.request(command),
    });
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
      const conversation = await getRemotePiConversation(this.client);
      if (!isTerminalStatus(this.runStatus)) {
        return conversation;
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
      this.hasSnapshot = true;
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
    if (isTerminalStatus(this.runStatus)) {
      return this.terminalResponseWhenReady(command);
    }

    if (readinessCommands.has(command.type)) {
      await this.waitForRuntimeReady();
      if (isTerminalStatus(this.runStatus)) {
        return this.terminalResponseWhenReady(command);
      }
    }

    const input = {
      taskId: this.context.taskId,
      runId: this.context.runId,
      apiHost: this.context.apiHost,
      teamId: this.context.teamId,
      method: "pi/rpc" as const,
      params: { command },
    };
    const maxAttempts = readinessCommands.has(command.type) ? 3 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (isTerminalStatus(this.runStatus)) {
        return this.terminalResponseWhenReady(command);
      }

      const result = await this.cloudTaskClient.sendCommand(input);
      if (result.success) {
        return result.result;
      }
      if (isTerminalStatus(this.runStatus)) {
        return this.terminalResponseWhenReady(command);
      }

      const error = result.error ?? `Pi RPC command failed: ${command.type}`;
      if (attempt === maxAttempts || !result.retryable) {
        throw new Error(error);
      }

      await Promise.race([
        new Promise((resolve) => setTimeout(resolve, 1_000)),
        this.terminalStatusReceived,
      ]);
    }

    throw new Error(`Pi RPC command failed: ${command.type}`);
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

    const readiness = await new Promise<"ready" | "terminal" | "fallback">(
      (resolve) => {
        let settled = false;
        const settle = (value: "ready" | "terminal" | "fallback") => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve(value);
        };
        const timeout = setTimeout(() => settle("fallback"), 10_000);
        void this.runtimeReadyReceived.then(() => settle("ready"));
        void this.terminalStatusReceived.then(() => settle("terminal"));
      },
    );
    if (readiness !== "fallback" || !this.context.waitUntilReady) {
      return;
    }

    this.runStatus = await this.context.waitUntilReady();
    if (isTerminalStatus(this.runStatus) || this.runtimeReady) {
      return;
    }

    const nativeReadiness = await new Promise<"ready" | "terminal" | "legacy">(
      (resolve) => {
        let settled = false;
        const settle = (value: "ready" | "terminal" | "legacy") => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve(value);
        };
        const timeout = setTimeout(() => settle("legacy"), 30_000);
        void this.runtimeReadyReceived.then(() => settle("ready"));
        void this.terminalStatusReceived.then(() => settle("terminal"));
      },
    );
    if (nativeReadiness === "legacy") {
      this.markRuntimeReady();
    }
  }

  private async terminalResponseWhenReady(
    command: RpcCommand,
  ): Promise<unknown> {
    if (command.type === "get_entries" && !this.hasSnapshot) {
      await this.snapshotReceived;
    }

    return this.terminalResponse(command);
  }

  private terminalResponse(command: RpcCommand): unknown {
    let data: unknown;
    if (command.type === "get_state") {
      data = {
        isStreaming: false,
        isCompacting: false,
        thinkingLevel: "off",
        steeringMode: "all",
        followUpMode: "all",
        sessionId: this.context.runId,
        autoCompactionEnabled: true,
        messageCount: 0,
        pendingMessageCount: 0,
      };
    } else if (command.type === "get_available_models") {
      data = { models: [] };
    } else if (command.type === "get_available_thinking_levels") {
      data = { levels: [] };
    } else if (command.type === "get_commands") {
      data = { commands: [] };
    } else if (command.type === "get_entries" && this.hasSnapshot) {
      data = { entries: [] };
    } else {
      throw new Error(
        `Cloud task run ${this.context.runId} is ${this.runStatus}`,
      );
    }

    return {
      type: "response",
      command: command.type,
      success: true,
      data,
    };
  }
}
