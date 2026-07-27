import type { PiRemoteRpcClient } from "@posthog/agent/pi/remote-rpc-client";
import type {
  PiNativeModelInfo,
  PiQueueMode,
  PiThinkingLevel,
} from "@posthog/agent/pi/types";
import type {
  AgentConversationEvent,
  PiMessagingMode,
  PiRuntimeHealth,
  TaskRunStatus,
} from "@posthog/shared";
import { inject, injectable } from "inversify";
import { parseCommandLine } from "../message-editor/commands";
import { TASK_SERVICE, type TaskService } from "../task-detail/taskService";
import {
  createEmptyPiControllerSession,
  createPiSessionStore,
  type PiControllerSessionState,
  type PiSessionStore,
} from "./piSessionStore";

export type {
  PiNativeModelInfo,
  PiQueueMode,
  PiThinkingLevel,
} from "@posthog/agent/pi/types";

export type PiModelSelection = Pick<PiNativeModelInfo, "provider" | "id">;

export const PI_SESSION_PROVIDER = Symbol.for("posthog.pi.sessionProvider");
export const LOCAL_PI_SESSION_FACTORY = Symbol.for(
  "posthog.pi.localSessionFactory",
);

export interface PiSession {
  client: PiRemoteRpcClient;
  readonly resumeRequired?: boolean;
  readonly cloudStatus?: TaskRunStatus;
  retry?(): Promise<void>;
  sendUserMessage?(
    type: "prompt" | "steer" | "follow_up",
    message: string,
    artifactIds: string[],
    id: string,
  ): Promise<void>;
  health(): Promise<PiRuntimeHealth>;
  getConversation(): Promise<AgentConversationEvent[]>;
  onConversationEvent(
    onEvent: (event: AgentConversationEvent) => void,
    onError: (error: unknown) => void,
    onCloudStatus?: (status: TaskRunStatus) => void,
  ): () => void;
}

export interface PiSessionFactory {
  get(taskId: string, taskRunId?: string): Promise<PiSession>;
}

export type PiSessionProvider = PiSessionFactory;

export type PiSubmitResult = "prompt" | "steer" | "followUp" | "compact";

function normalizeSessionError(error: unknown): {
  title: string;
  message: string;
  retryable: boolean;
} {
  const value = error as {
    title?: unknown;
    message?: unknown;
    retryable?: unknown;
  };
  return {
    title: typeof value?.title === "string" ? value.title : "Connection failed",
    message: typeof value?.message === "string" ? value.message : String(error),
    retryable: value?.retryable !== false,
  };
}

@injectable()
export class PiSessionController {
  readonly store: PiSessionStore = createPiSessionStore();

  private readonly sessions = new Map<string, Promise<PiSession>>();
  private readonly subscriptions = new Map<string, () => void>();
  private readonly liveEvents = new Map<string, AgentConversationEvent[]>();
  private readonly connections = new Map<string, Promise<void>>();
  private readonly readiness = new Map<string, Promise<void>>();
  private readonly sessionVersions = new Map<string, number>();
  private readonly taskRunIds = new Map<string, string>();

  constructor(
    @inject(PI_SESSION_PROVIDER) private readonly provider: PiSessionProvider,
    @inject(TASK_SERVICE) private readonly taskService: TaskService,
  ) {}

  ensureConnected(taskId: string, taskRunId?: string): Promise<void> {
    this.bindTaskRun(taskId, taskRunId);
    this.ensureSubscription(taskId);

    const existing = this.readiness.get(taskId);
    if (existing) {
      return existing;
    }

    this.updateSession(taskId, {
      connectionState: "connecting",
      errorTitle: undefined,
      errorMessage: undefined,
      errorRetryable: undefined,
    });
    const connectedSessionVersion = this.getSessionVersion(taskId);
    const readiness = this.ensureConnectedInternal(taskId)
      .then(() => {
        if (this.getSessionVersion(taskId) === connectedSessionVersion) {
          this.updateSession(taskId, {
            connectionState: "connected",
            errorTitle: undefined,
            errorMessage: undefined,
            errorRetryable: undefined,
          });
        }
      })
      .catch((error) => {
        if (this.getSessionVersion(taskId) === connectedSessionVersion) {
          this.applySessionError(taskId, error);
        }
        throw error;
      })
      .finally(() => {
        if (this.readiness.get(taskId) === readiness) {
          this.readiness.delete(taskId);
        }
      });
    this.readiness.set(taskId, readiness);
    return readiness;
  }

  connect(taskId: string, taskRunId?: string): Promise<void> {
    this.bindTaskRun(taskId, taskRunId);
    this.ensureSubscription(taskId);

    const existing = this.connections.get(taskId);
    if (existing) {
      return existing;
    }

    this.updateSession(taskId, {
      errorTitle: undefined,
      errorMessage: undefined,
      errorRetryable: undefined,
    });

    const connection = this.loadSession(taskId).finally(() => {
      if (this.connections.get(taskId) === connection) {
        this.connections.delete(taskId);
      }
    });
    this.connections.set(taskId, connection);
    return connection;
  }

  disconnect(taskId: string): void {
    this.resetTransport(taskId);
    this.taskRunIds.delete(taskId);
    this.liveEvents.delete(taskId);
  }

  async retry(taskId: string): Promise<void> {
    const taskRunId = this.taskRunIds.get(taskId);
    const session = await this.getPiSession(taskId);
    this.updateSession(taskId, {
      connectionState: "connecting",
      errorTitle: undefined,
      errorMessage: undefined,
      errorRetryable: undefined,
    });
    try {
      await session.retry?.();
      this.resetTransport(taskId);
      await this.ensureConnected(taskId, taskRunId);
    } catch (error) {
      this.applySessionError(taskId, error);
      throw error;
    }
  }

  async restart(taskId: string): Promise<void> {
    const taskRunId = this.taskRunIds.get(taskId);
    if (!taskRunId) {
      await this.retry(taskId);
      return;
    }

    this.updateSession(taskId, {
      connectionState: "connecting",
      errorTitle: undefined,
      errorMessage: undefined,
      errorRetryable: undefined,
    });
    try {
      const resumedRun = await this.taskService.resumeCloudPiRun(
        taskId,
        taskRunId,
      );
      this.resetTransport(taskId);
      await this.ensureConnected(taskId, resumedRun.id);
    } catch (error) {
      this.applySessionError(taskId, error);
      throw error;
    }
  }

  retryUnhealthyCloudSessions(): void {
    for (const [taskId, session] of Object.entries(
      this.store.getState().sessions,
    )) {
      if (
        session.cloudStatus !== undefined &&
        session.errorRetryable &&
        (session.connectionState === "disconnected" ||
          session.connectionState === "error")
      ) {
        void this.retry(taskId).catch(() => {});
      }
    }
  }

  getSubmitAction(
    text: string,
    isStreaming: boolean,
    messagingMode: PiMessagingMode,
  ): PiSubmitResult {
    const command = parseCommandLine(text.trim());
    if (command?.name === "compact") {
      return "compact";
    }

    if (!isStreaming) {
      return "prompt";
    }

    return messagingMode === "steer" ? "steer" : "followUp";
  }

  async submit(
    taskId: string,
    text: string,
    isStreaming: boolean,
    messagingMode: PiMessagingMode,
  ): Promise<PiSubmitResult> {
    const message = text.trim();
    const action = this.getSubmitAction(message, isStreaming, messagingMode);

    const currentSession = await this.getPiSession(taskId);
    const wasStreaming = this.getSession(taskId).status?.isStreaming ?? false;
    if (action === "compact") {
      const session = await this.getWritablePiSession(taskId);
      const command = parseCommandLine(message);
      const customInstructions = command?.args?.trim() || undefined;
      await session.client.compact(customInstructions);
    } else {
      const commandType = action === "followUp" ? "follow_up" : action;
      const messageId = currentSession.sendUserMessage
        ? globalThis.crypto.randomUUID()
        : undefined;
      if (messageId) {
        this.appendOptimisticUserMessage(taskId, messageId, message);
      }
      this.markTurnPending(taskId);
      if (currentSession.resumeRequired) {
        this.updateSession(taskId, { connectionState: "connecting" });
      }

      try {
        const session = await this.getWritablePiSession(taskId);
        this.markTurnPending(taskId);
        if (session.sendUserMessage && messageId) {
          const taskRunId = this.taskRunIds.get(taskId);
          const prepared = taskRunId
            ? await this.taskService.prepareCloudPiMessage(
                taskId,
                taskRunId,
                message,
              )
            : { content: message, artifactIds: [] };
          await session.sendUserMessage(
            commandType,
            prepared.content,
            prepared.artifactIds,
            messageId,
          );
        } else if (action === "prompt") {
          await session.client.prompt(message);
        } else if (action === "steer") {
          await session.client.steer(message);
        } else {
          await session.client.followUp(message);
        }
      } catch (error) {
        if (messageId) {
          this.removeUserMessage(taskId, messageId);
        }
        this.setTurnStreaming(taskId, wasStreaming);
        throw error;
      }
    }

    await this.refreshStatus(taskId);
    return action;
  }

  async setModel(taskId: string, model: PiModelSelection): Promise<void> {
    const session = await this.getPiSession(taskId);
    await session.client.setModel(model.provider, model.id);
    await this.refreshStatus(taskId);
    const thinkingLevels = await session.client.getAvailableThinkingLevels();
    this.updateSession(taskId, {
      thinkingLevels,
      thinkingLevelsLoaded: true,
    });
  }

  async setThinkingLevel(
    taskId: string,
    level: PiThinkingLevel,
  ): Promise<void> {
    const session = await this.getPiSession(taskId);
    await session.client.setThinkingLevel(level);
    await this.refreshStatus(taskId);
  }

  async setQueueMode(
    taskId: string,
    messagingMode: PiMessagingMode,
    queueMode: PiQueueMode,
  ): Promise<void> {
    const session = await this.getPiSession(taskId);
    if (messagingMode === "steer") {
      await session.client.setSteeringMode(queueMode);
    } else {
      await session.client.setFollowUpMode(queueMode);
    }
    await this.refreshStatus(taskId);
  }

  async bash(taskId: string, command: string): Promise<void> {
    this.updateSession(taskId, { isBashRunning: true });
    try {
      const session = await this.getPiSession(taskId);
      await session.client.bash(command);
    } finally {
      this.updateSession(taskId, { isBashRunning: false });
    }
  }

  async abort(taskId: string): Promise<void> {
    const session = await this.getPiSession(taskId);
    await session.client.abort();
    await this.refreshStatus(taskId);
  }

  async abortBash(taskId: string): Promise<void> {
    const session = await this.getPiSession(taskId);
    await session.client.abortBash();
    this.updateSession(taskId, { isBashRunning: false });
  }

  private async ensureConnectedInternal(taskId: string): Promise<void> {
    const session = await this.getPiSession(taskId);
    const health = await session.health();
    if (health.state === "cold") {
      const taskRunId = this.taskRunIds.get(taskId);
      const result = taskRunId
        ? await this.taskService.openTask(taskId, taskRunId)
        : await this.taskService.openTask(taskId);
      if (!result.success) {
        throw new Error(result.error);
      }

      this.subscriptions.get(taskId)?.();
      this.subscriptions.delete(taskId);
      this.sessions.delete(taskId);
      this.connections.delete(taskId);
      this.ensureSubscription(taskId);
    }

    await this.connect(taskId);
  }

  private ensureSubscription(taskId: string): void {
    if (this.subscriptions.has(taskId)) {
      return;
    }

    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void this.getPiSession(taskId)
      .then((session) => {
        if (disposed) {
          return;
        }
        this.updateSession(taskId, { cloudStatus: session.cloudStatus });
        unsubscribe = session.onConversationEvent(
          (event) => this.handleEvent(taskId, event),
          (error) => this.applySessionError(taskId, error),
          (cloudStatus) => this.updateSession(taskId, { cloudStatus }),
        );
      })
      .catch((error) => this.applySessionError(taskId, error));
    this.subscriptions.set(taskId, () => {
      disposed = true;
      unsubscribe?.();
    });
  }

  private async loadSession(taskId: string): Promise<void> {
    const connectedSessionVersion = this.getSessionVersion(taskId);
    try {
      const session = await this.getPiSession(taskId);
      const events = await session.getConversation();
      const status = await session.client.getState();
      if (this.getSessionVersion(taskId) !== connectedSessionVersion) {
        return;
      }

      const currentSession = this.getSession(taskId);
      const liveEvents = this.liveEvents.get(taskId) ?? [];
      const newLiveEvents = this.reconcileLiveEvents(events, liveEvents);
      this.liveEvents.set(taskId, newLiveEvents);
      const historyUserMessageIds = new Set(
        events.flatMap((event) =>
          event.type === "user_message" ? [event.id] : [],
        ),
      );
      const optimisticEvents = currentSession.events.filter(
        (event) =>
          event.sourceId?.startsWith("optimistic:") &&
          (event.type !== "user_message" ||
            !historyUserMessageIds.has(event.id)),
      );
      const reconciledEvents = [
        ...events,
        ...newLiveEvents,
        ...optimisticEvents,
      ];

      this.setSession(taskId, {
        connectionState: "connected",
        events: reconciledEvents,
        status,
        models: currentSession.models,
        modelsLoaded: currentSession.modelsLoaded,
        thinkingLevels: currentSession.thinkingLevels,
        thinkingLevelsLoaded: currentSession.thinkingLevelsLoaded,
        commands: currentSession.commands,
        isBashRunning: false,
        errorTitle: undefined,
        errorMessage: undefined,
        errorRetryable: undefined,
      });

      await Promise.all([
        session.client.getAvailableModels().then((models) => {
          if (this.getSessionVersion(taskId) === connectedSessionVersion) {
            this.updateSession(taskId, { models, modelsLoaded: true });
          }
        }),
        session.client.getAvailableThinkingLevels().then((thinkingLevels) => {
          if (this.getSessionVersion(taskId) === connectedSessionVersion) {
            this.updateSession(taskId, {
              thinkingLevels,
              thinkingLevelsLoaded: true,
            });
          }
        }),
        session.client.getCommands().then((commands) => {
          if (this.getSessionVersion(taskId) === connectedSessionVersion) {
            this.updateSession(taskId, { commands });
          }
        }),
      ]);
    } catch (error) {
      if (this.getSessionVersion(taskId) === connectedSessionVersion) {
        this.applySessionError(taskId, error);
      }
      throw error;
    }
  }

  private handleEvent(taskId: string, event: AgentConversationEvent): void {
    const liveEvents = [...(this.liveEvents.get(taskId) ?? []), event];
    this.liveEvents.set(taskId, liveEvents);
    const session = this.getSession(taskId);
    let status = session.status;
    if (status && event.type === "runtime_status") {
      if (event.status === "compacting") {
        status = { ...status, isCompacting: !event.isComplete };
      } else if (event.status === "compacting_failed") {
        status = { ...status, isCompacting: false };
      }
    }
    const hasTurnActivity =
      event.type === "assistant_message_chunk" ||
      event.type === "assistant_thought_chunk" ||
      event.type === "tool_call_started" ||
      event.type === "tool_call_updated";
    if (status && hasTurnActivity) {
      status = { ...status, isStreaming: true };
    }
    if (status && event.type === "turn_completed") {
      status = { ...status, isStreaming: false };
    }

    const existingUserMessageIndex =
      event.type === "user_message"
        ? session.events.findIndex(
            (candidate) =>
              candidate.type === "user_message" && candidate.id === event.id,
          )
        : -1;
    const events = [...session.events];
    if (existingUserMessageIndex >= 0) {
      events[existingUserMessageIndex] = event;
    } else {
      events.push(event);
    }

    this.updateSession(taskId, {
      connectionState:
        event.type === "progress" ? session.connectionState : "connected",
      events,
      status,
      errorTitle: undefined,
      errorMessage: undefined,
      errorRetryable: undefined,
    });
  }

  private reconcileLiveEvents(
    historyEvents: AgentConversationEvent[],
    liveEvents: AgentConversationEvent[],
  ): AgentConversationEvent[] {
    const historySourceIds = new Set(
      historyEvents.flatMap((event) =>
        event.sourceId ? [event.sourceId] : [],
      ),
    );
    return liveEvents.filter(
      (event) => !event.sourceId || !historySourceIds.has(event.sourceId),
    );
  }

  private markTurnPending(taskId: string): void {
    this.setTurnStreaming(taskId, true);
  }

  private setTurnStreaming(taskId: string, isStreaming: boolean): void {
    const session = this.getSession(taskId);
    if (!session.status) {
      return;
    }

    this.updateSession(taskId, {
      status: { ...session.status, isStreaming },
    });
  }

  private appendOptimisticUserMessage(
    taskId: string,
    messageId: string,
    content: string,
  ): void {
    const session = this.getSession(taskId);
    this.updateSession(taskId, {
      events: [
        ...session.events,
        {
          type: "user_message",
          id: messageId,
          sourceId: `optimistic:${messageId}`,
          timestamp: Date.now(),
          content: [{ type: "text", text: content }],
        },
      ],
    });
  }

  private removeUserMessage(taskId: string, messageId: string): void {
    const session = this.getSession(taskId);
    this.updateSession(taskId, {
      events: session.events.filter(
        (event) => event.type !== "user_message" || event.id !== messageId,
      ),
    });
  }

  private async refreshStatus(taskId: string): Promise<void> {
    const session = await this.getPiSession(taskId);
    const status = await session.client.getState();
    this.updateSession(taskId, { status });
  }

  private async getWritablePiSession(taskId: string): Promise<PiSession> {
    const session = await this.getPiSession(taskId);
    const taskRunId = this.taskRunIds.get(taskId);
    if (!session.resumeRequired || !taskRunId) {
      return session;
    }

    const resumedRun = await this.taskService.resumeCloudPiRun(
      taskId,
      taskRunId,
    );
    this.disconnect(taskId);
    await this.ensureConnected(taskId, resumedRun.id);
    return this.getPiSession(taskId);
  }

  private bindTaskRun(taskId: string, taskRunId?: string): void {
    const currentTaskRunId = this.taskRunIds.get(taskId);
    if (!taskRunId || currentTaskRunId === taskRunId) {
      return;
    }

    if (currentTaskRunId) {
      this.resetTransport(taskId);
      this.liveEvents.delete(taskId);
    }
    this.taskRunIds.set(taskId, taskRunId);
  }

  private resetTransport(taskId: string): void {
    this.advanceSessionVersion(taskId);
    this.subscriptions.get(taskId)?.();
    this.subscriptions.delete(taskId);
    this.sessions.delete(taskId);
    this.connections.delete(taskId);
    this.readiness.delete(taskId);
  }

  private getPiSession(taskId: string): Promise<PiSession> {
    const existing = this.sessions.get(taskId);
    if (existing) {
      return existing;
    }

    const session = this.provider.get(taskId, this.taskRunIds.get(taskId));
    this.sessions.set(taskId, session);
    void session.catch(() => {
      if (this.sessions.get(taskId) === session) {
        this.sessions.delete(taskId);
      }
    });
    return session;
  }

  private getSessionVersion(taskId: string): number {
    return this.sessionVersions.get(taskId) ?? 0;
  }

  private advanceSessionVersion(taskId: string): void {
    this.sessionVersions.set(taskId, this.getSessionVersion(taskId) + 1);
  }

  private getSession(taskId: string): PiControllerSessionState {
    return (
      this.store.getState().sessions[taskId] ?? createEmptyPiControllerSession()
    );
  }

  private setSession(taskId: string, session: PiControllerSessionState): void {
    this.store.setState((state) => ({
      sessions: { ...state.sessions, [taskId]: session },
    }));
  }

  private applySessionError(taskId: string, error: unknown): void {
    const failure = normalizeSessionError(error);
    this.updateSession(taskId, {
      connectionState: failure.retryable ? "disconnected" : "error",
      errorTitle: failure.title,
      errorMessage: failure.message,
      errorRetryable: failure.retryable,
    });
  }

  private updateSession(
    taskId: string,
    update: Partial<PiControllerSessionState>,
  ): void {
    this.setSession(taskId, { ...this.getSession(taskId), ...update });
  }
}
