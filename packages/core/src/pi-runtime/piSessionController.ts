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
  sendUserMessage?(
    type: "prompt" | "steer" | "follow_up",
    message: string,
    artifactIds: string[],
  ): Promise<void>;
  health(): Promise<PiRuntimeHealth>;
  getConversation(): Promise<AgentConversationEvent[]>;
  onConversationEvent(
    onEvent: (event: AgentConversationEvent) => void,
    onError: (error: unknown) => void,
  ): () => void;
}

export interface PiSessionFactory {
  get(taskId: string, taskRunId?: string): Promise<PiSession>;
}

export type PiSessionProvider = PiSessionFactory;

export type PiSubmitResult = "prompt" | "steer" | "followUp" | "compact";

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
      error: undefined,
    });
    const connectedSessionVersion = this.getSessionVersion(taskId);
    const readiness = this.ensureConnectedInternal(taskId)
      .then(() => {
        if (this.getSessionVersion(taskId) === connectedSessionVersion) {
          this.updateSession(taskId, { connectionState: "connected" });
        }
      })
      .catch((error) => {
        if (this.getSessionVersion(taskId) === connectedSessionVersion) {
          this.updateSession(taskId, {
            connectionState: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
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

    this.updateSession(taskId, { error: undefined });

    const connection = this.loadSession(taskId).finally(() => {
      if (this.connections.get(taskId) === connection) {
        this.connections.delete(taskId);
      }
    });
    this.connections.set(taskId, connection);
    return connection;
  }

  disconnect(taskId: string): void {
    this.advanceSessionVersion(taskId);
    this.subscriptions.get(taskId)?.();
    this.subscriptions.delete(taskId);
    this.sessions.delete(taskId);
    this.taskRunIds.delete(taskId);
    this.liveEvents.delete(taskId);
    this.connections.delete(taskId);
    this.readiness.delete(taskId);
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

    const session = await this.getWritablePiSession(taskId);
    if (action === "compact") {
      const command = parseCommandLine(message);
      const customInstructions = command?.args?.trim() || undefined;
      await session.client.compact(customInstructions);
    } else {
      const taskRunId = this.taskRunIds.get(taskId);
      const prepared =
        taskRunId && session.sendUserMessage
          ? await this.taskService.prepareCloudPiMessage(
              taskId,
              taskRunId,
              message,
            )
          : { content: message, artifactIds: [] };
      if (session.sendUserMessage) {
        const commandType = action === "followUp" ? "follow_up" : action;
        await session.sendUserMessage(
          commandType,
          prepared.content,
          prepared.artifactIds,
        );
      } else if (action === "prompt") {
        await session.client.prompt(prepared.content);
      } else if (action === "steer") {
        await session.client.steer(prepared.content);
      } else {
        await session.client.followUp(prepared.content);
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
        unsubscribe = session.onConversationEvent(
          (event) => this.handleEvent(taskId, event),
          (error) => {
            this.updateSession(taskId, {
              error: error instanceof Error ? error.message : String(error),
            });
          },
        );
      })
      .catch((error) => {
        this.updateSession(taskId, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
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
      const reconciledEvents = [...events, ...newLiveEvents];

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
        error: undefined,
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
        this.updateSession(taskId, {
          error: error instanceof Error ? error.message : String(error),
        });
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
    if (status && event.type === "turn_completed") {
      status = { ...status, isStreaming: false };
    }

    this.updateSession(taskId, {
      events: [...session.events, event],
      status,
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
      this.advanceSessionVersion(taskId);
      this.subscriptions.get(taskId)?.();
      this.subscriptions.delete(taskId);
      this.sessions.delete(taskId);
      this.liveEvents.delete(taskId);
      this.connections.delete(taskId);
      this.readiness.delete(taskId);
    }
    this.taskRunIds.set(taskId, taskRunId);
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

  private updateSession(
    taskId: string,
    update: Partial<PiControllerSessionState>,
  ): void {
    this.setSession(taskId, { ...this.getSession(taskId), ...update });
  }
}
