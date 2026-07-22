import type { PiRemoteRpcClient } from "@posthog/agent/pi/remote-rpc-client";
import type {
  PiModelOption,
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
  PiModelOption,
  PiQueueMode,
  PiThinkingLevel,
} from "@posthog/agent/pi/types";

export const PI_SESSION_PROVIDER = Symbol.for("posthog.pi.sessionProvider");
export const LOCAL_PI_SESSION_FACTORY = Symbol.for(
  "posthog.pi.localSessionFactory",
);

export interface PiSession {
  client: PiRemoteRpcClient;
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
  private readonly conversationRequestVersions = new Map<string, number>();
  private readonly conversationAppliedVersions = new Map<string, number>();
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
    this.conversationRequestVersions.delete(taskId);
    this.conversationAppliedVersions.delete(taskId);
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

    const session = await this.getPiSession(taskId);
    if (action === "compact") {
      const command = parseCommandLine(message);
      const customInstructions = command?.args?.trim() || undefined;
      await session.client.compact(customInstructions);
      await this.refreshConversation(taskId);
    } else if (action === "prompt") {
      await session.client.prompt(message);
    } else if (action === "steer") {
      await session.client.steer(message);
    } else {
      await session.client.followUp(message);
    }

    await this.refreshStatus(taskId);
    return action;
  }

  async setModel(taskId: string, model: PiModelOption): Promise<void> {
    const session = await this.getPiSession(taskId);
    await session.client.setModel(model.provider, model.id);
    await this.refreshStatus(taskId);
    const thinkingLevels = await session.client.getAvailableThinkingLevels();
    this.updateSession(taskId, { thinkingLevels });
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
      await this.refreshConversation(taskId);
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
    const conversationVersion = this.nextConversationVersion(taskId);
    try {
      const session = await this.getPiSession(taskId);
      const events = await session.getConversation();
      const status = await session.client.getState();
      if (this.getSessionVersion(taskId) !== connectedSessionVersion) {
        return;
      }

      const currentSession = this.getSession(taskId);
      let reconciledEvents = currentSession.events;
      if (this.shouldApplyConversation(taskId, conversationVersion)) {
        const liveEvents = this.liveEvents.get(taskId) ?? [];
        const newLiveEvents = this.reconcileLiveEvents(events, liveEvents);
        this.liveEvents.set(taskId, newLiveEvents);
        reconciledEvents = [...events, ...newLiveEvents];
      }

      this.setSession(taskId, {
        connectionState: "connected",
        events: reconciledEvents,
        status,
        models: currentSession.models,
        thinkingLevels: currentSession.thinkingLevels,
        commands: currentSession.commands,
        isBashRunning: false,
        error: undefined,
      });

      const [models, thinkingLevels, commands] = await Promise.all([
        session.client.getAvailableModels(),
        session.client.getAvailableThinkingLevels(),
        session.client.getCommands(),
      ]);
      if (this.getSessionVersion(taskId) === connectedSessionVersion) {
        this.updateSession(taskId, { models, thinkingLevels, commands });
      }
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

    if (event.type === "turn_completed") {
      void this.refreshConversation(taskId).catch(() => {});
    }
  }

  private async refreshConversation(taskId: string): Promise<void> {
    const conversationVersion = this.nextConversationVersion(taskId);
    const sessionVersion = this.getSessionVersion(taskId);
    const session = await this.getPiSession(taskId);
    const events = await session.getConversation();
    if (
      this.getSessionVersion(taskId) !== sessionVersion ||
      !this.shouldApplyConversation(taskId, conversationVersion)
    ) {
      return;
    }

    const liveEvents = this.liveEvents.get(taskId) ?? [];
    const remainingEvents = this.reconcileLiveEvents(events, liveEvents);
    this.liveEvents.set(taskId, remainingEvents);
    this.updateSession(taskId, {
      events: [...events, ...remainingEvents],
    });
  }

  private nextConversationVersion(taskId: string): number {
    const version = (this.conversationRequestVersions.get(taskId) ?? 0) + 1;
    this.conversationRequestVersions.set(taskId, version);
    return version;
  }

  private shouldApplyConversation(taskId: string, version: number): boolean {
    const appliedVersion = this.conversationAppliedVersions.get(taskId) ?? 0;
    if (version < appliedVersion) {
      return false;
    }

    this.conversationAppliedVersions.set(taskId, version);
    return true;
  }

  private reconcileLiveEvents(
    nativeEvents: AgentConversationEvent[],
    liveEvents: AgentConversationEvent[],
  ): AgentConversationEvent[] {
    const nativeEventCounts = new Map<string, number>();
    const nativeTextByMessage = new Map<string, string>();

    for (const event of nativeEvents) {
      const textMessageKey = this.getTextMessageKey(event);
      const text = this.getTextContent(event);
      if (textMessageKey && text !== undefined) {
        const nativeText = nativeTextByMessage.get(textMessageKey) ?? "";
        nativeTextByMessage.set(textMessageKey, nativeText + text);
        continue;
      }

      const key = this.getEventKey(event);
      nativeEventCounts.set(key, (nativeEventCounts.get(key) ?? 0) + 1);
    }

    const nativeTextOffsets = new Map<string, number>();
    return liveEvents.filter((event) => {
      const textMessageKey = this.getTextMessageKey(event);
      const text = this.getTextContent(event);
      if (textMessageKey && text !== undefined) {
        const nativeText = nativeTextByMessage.get(textMessageKey);
        if (nativeText === undefined) {
          return true;
        }

        const offset = nativeTextOffsets.get(textMessageKey) ?? 0;
        const matchIndex = nativeText.indexOf(text, offset);
        if (matchIndex === -1) {
          return true;
        }

        nativeTextOffsets.set(textMessageKey, matchIndex + text.length);
        return false;
      }

      const key = this.getEventKey(event);
      const nativeCount = nativeEventCounts.get(key) ?? 0;
      if (nativeCount === 0) {
        return true;
      }

      nativeEventCounts.set(key, nativeCount - 1);
      return false;
    });
  }

  private getTextMessageKey(event: AgentConversationEvent): string | undefined {
    if (
      event.type !== "assistant_message_chunk" &&
      event.type !== "assistant_thought_chunk"
    ) {
      return undefined;
    }

    if (event.content.type !== "text") {
      return undefined;
    }

    return `${event.type}:${event.timestamp}`;
  }

  private getTextContent(event: AgentConversationEvent): string | undefined {
    if (
      event.type !== "assistant_message_chunk" &&
      event.type !== "assistant_thought_chunk"
    ) {
      return undefined;
    }

    return event.content.type === "text" ? event.content.text : undefined;
  }

  private getEventKey(event: AgentConversationEvent): string {
    if (event.type === "user_message") {
      return JSON.stringify({
        type: event.type,
        timestamp: event.timestamp,
        content: event.content,
      });
    }

    return JSON.stringify(event);
  }

  private async refreshStatus(taskId: string): Promise<void> {
    const session = await this.getPiSession(taskId);
    const status = await session.client.getState();
    this.updateSession(taskId, { status });
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
      this.conversationRequestVersions.delete(taskId);
      this.conversationAppliedVersions.delete(taskId);
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
