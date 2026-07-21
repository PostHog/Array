import type {
  CloudPermissionOption,
  CloudTaskUpdatePayload,
  StoredLogEntry,
} from "@posthog/shared";
import { isTerminalStatus } from "@posthog/shared";
import { CloudTaskCommandController } from "./cloudTaskCommandController";
import type { CloudTaskQueuedMessage } from "./cloudTaskQueue";
import { CloudTaskRunLifecycle } from "./cloudTaskRunLifecycle";
import {
  convertStoredEntriesToPortableSessionEvents,
  type PortableSessionEvent,
  type PortableSessionNotification,
} from "./portableSessionEvents";

export type CloudTaskSessionConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type CloudTaskSessionTerminalStatus = "completed" | "failed";

export type CloudTaskSessionNotificationKind =
  | "turn_complete"
  | "awaiting_user_input"
  | "task_failed";

export interface CloudTaskSessionPermissionRequest {
  requestId: string;
  toolCall: {
    toolCallId: string;
    title: string;
    kind: string;
    content?: unknown[];
    rawInput?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
  options: CloudPermissionOption[];
  response?: {
    optionId: string;
    displayText: string;
    answers?: Record<string, string>;
    customInput?: string;
  };
}

export interface CloudTaskSession {
  taskRunId: string;
  taskId: string;
  taskTitle?: string;
  events: PortableSessionEvent[];
  status: CloudTaskSessionConnectionStatus;
  isPromptPending: boolean;
  localUserEchoes?: Set<string>;
  terminalStatus?: CloudTaskSessionTerminalStatus;
  lastError?: string | null;
  awaitingPing?: boolean;
  promptStartedAt?: number;
  awaitingAgentOutput?: boolean;
  lastEventAt?: number;
  cloudPermissionRequestIds?: Record<string, string>;
  pendingPermissions?: Record<string, CloudTaskSessionPermissionRequest>;
  isCompacting?: boolean;
  stopRequested?: boolean;
}

export interface CloudTaskSessionTask {
  id: string;
  title?: string;
  latestRun?: CloudTaskSessionRun;
}

export interface CloudTaskSessionRun {
  id: string;
  branch?: string | null;
  reasoningEffort?: string | null;
  initialPermissionMode?: string;
}

export interface CloudTaskRunOptions {
  branch?: string | null;
  resumeFromRunId?: string;
  pendingUserMessage?: string;
  reasoningEffort?: string;
  initialPermissionMode?: string;
  rtkEnabled?: boolean;
}

export interface CloudTaskComposerConfig {
  reasoning?: string;
  mode?: string;
}

export interface CloudTaskPermissionResponse {
  toolCallId: string;
  optionId: string;
  answers?: Record<string, string>;
  customInput?: string;
  displayText: string;
}

export interface CloudTaskPreparedPrompt {
  wirePayload: string;
  eventAttachments?: PortableSessionNotification["update"] extends infer Update
    ? Update extends { attachments?: infer Attachments }
      ? Attachments
      : never
    : never;
}

export interface CloudTaskSessionStatePort {
  getByTaskId(taskId: string): CloudTaskSession | undefined;
  getByRunId(runId: string): CloudTaskSession | undefined;
  set(session: CloudTaskSession): void;
  update(
    runId: string,
    updater: (session: CloudTaskSession) => CloudTaskSession,
  ): void;
  remove(runId: string): void;
}

export interface CloudTaskSessionApiPort {
  getTask(taskId: string): Promise<CloudTaskSessionTask>;
  runTask(
    taskId: string,
    options?: CloudTaskRunOptions,
  ): Promise<CloudTaskSessionTask>;
  sendCommand(
    taskId: string,
    runId: string,
    command:
      | "user_message"
      | "permission_response"
      | "set_config_option"
      | "cancel",
    payload?: Record<string, unknown>,
  ): Promise<void>;
  cancelRun(taskId: string, runId: string): Promise<void>;
  classifyCommandError(
    error: unknown,
  ): { kind: "sandbox_inactive" } | { kind: "transient" } | { kind: "other" };
}

export interface CloudTaskWatcherHandle {
  stop(): void;
  reconnectIfDisconnected(): void;
}

export interface CloudTaskWatcherPort {
  create(args: {
    taskId: string;
    runId: string;
    onUpdate: (update: CloudTaskUpdatePayload) => void;
  }): CloudTaskWatcherHandle;
}

export interface CloudTaskQueuePort<Attachment> {
  get(taskId: string): readonly CloudTaskQueuedMessage<Attachment>[];
  drain(
    taskId: string,
    options: { stopAtEdited: true },
  ): CloudTaskQueuedMessage<Attachment>[];
  prepend(
    taskId: string,
    messages: readonly CloudTaskQueuedMessage<Attachment>[],
  ): void;
  remove(taskId: string, messageId: string): void;
  combine(messages: readonly CloudTaskQueuedMessage<Attachment>[]): {
    text: string;
    attachments: Attachment[];
  };
}

export interface CloudTaskPromptPort<Attachment> {
  prepare(
    prompt: string,
    attachments: Attachment[],
  ): Promise<CloudTaskPreparedPrompt>;
  reinjectSnapshotAttachments?(
    taskRunId: string,
    events: PortableSessionEvent[],
  ): void;
  recordAttachmentEcho?(
    taskRunId: string,
    prompt: string,
    attachments: NonNullable<CloudTaskPreparedPrompt["eventAttachments"]>,
  ): void;
}

export interface CloudTaskSessionTimePort {
  now(): number;
  defer(callback: () => void): void;
}

export interface CloudTaskSessionLogger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, error?: unknown): void;
}

export interface CloudTaskSessionEffectsPort {
  onCompletion(args: {
    taskId: string;
    taskRunId: string;
    promptStartedAt?: number;
  }): void | Promise<void>;
  onNotification(args: {
    taskId: string;
    taskRunId: string;
    kind: CloudTaskSessionNotificationKind;
  }): void | Promise<void>;
}

export interface CloudTaskSessionPreferencesPort {
  getComposerConfig(taskId: string): CloudTaskComposerConfig | undefined;
  isRtkEnabled(): boolean;
}

export interface CloudTaskSessionServicePorts<Attachment> {
  state: CloudTaskSessionStatePort;
  api: CloudTaskSessionApiPort;
  watchers: CloudTaskWatcherPort;
  queue: CloudTaskQueuePort<Attachment>;
  prompts: CloudTaskPromptPort<Attachment>;
  time: CloudTaskSessionTimePort;
  logger: CloudTaskSessionLogger;
  effects: CloudTaskSessionEffectsPort;
  preferences: CloudTaskSessionPreferencesPort;
}

const visibleAgentSessionUpdates = new Set([
  "agent_message_chunk",
  "agent_message",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
]);

const turnEndMethods = new Set([
  "_posthog/turn_complete",
  "_posthog/task_complete",
  "_posthog/error",
  "_posthog/awaiting_user_input",
]);

interface EntryAnalysis {
  hasTurnEnd: boolean;
  hasAwaitingUserInput: boolean;
  hasTurnCompleted: boolean;
  hasTurnFailed: boolean;
  hasVisibleAgentOutput: boolean;
  externalUserMessageCount: number;
  agentMessageFinalized: boolean;
  compacting?: boolean;
}

export class CloudTaskSessionService<Attachment = unknown> {
  private readonly watcherHandles = new Map<string, CloudTaskWatcherHandle>();
  private readonly connectAttempts = new Set<string>();
  private readonly flushingTasks = new Set<string>();
  private readonly commandController: CloudTaskCommandController;
  private readonly runLifecycle: CloudTaskRunLifecycle;

  constructor(
    private readonly ports: CloudTaskSessionServicePorts<Attachment>,
  ) {
    this.commandController = new CloudTaskCommandController({
      sendCommand: (target, method, params) =>
        this.ports.api.sendCommand(
          target.taskId,
          target.taskRunId,
          method,
          params,
        ),
      stopRun: (target) =>
        this.ports.api.cancelRun(target.taskId, target.taskRunId),
    });
    this.runLifecycle = new CloudTaskRunLifecycle(this.commandController, {
      get: (taskRunId) => {
        const session = this.ports.state.getByRunId(taskRunId);
        return session
          ? {
              ...session,
              activityVersion: `${session.events.length}:${session.lastEventAt ?? ""}:${session.terminalStatus ?? ""}:${session.status}`,
            }
          : undefined;
      },
      update: (taskRunId, patch) =>
        this.ports.state.update(taskRunId, (current) => ({
          ...current,
          ...patch,
          promptStartedAt:
            patch.promptStartedAt === null ? undefined : patch.promptStartedAt,
        })),
    });
  }

  async connect(task: CloudTaskSessionTask): Promise<void> {
    if (this.connectAttempts.has(task.id)) return;
    if (this.ports.state.getByTaskId(task.id)?.status === "connected") return;

    this.connectAttempts.add(task.id);
    try {
      let runId = task.latestRun?.id;
      let awaitingPing = false;
      if (!runId) {
        runId = (await this.ports.api.runTask(task.id)).latestRun?.id;
        if (!runId) throw new Error("Cloud run was created without an id");
        awaitingPing = true;
      }

      const now = this.ports.time.now();
      this.ports.state.set({
        taskRunId: runId,
        taskId: task.id,
        taskTitle: task.title,
        events: [],
        status: "connecting",
        isPromptPending: true,
        awaitingPing,
        promptStartedAt: awaitingPing ? now : undefined,
        awaitingAgentOutput: true,
      });
      this.startWatcher(runId, task.id);
    } catch (error) {
      this.ports.logger.error("Failed to connect to cloud task", error);
      throw error;
    } finally {
      this.connectAttempts.delete(task.id);
    }
  }

  disconnect(taskId: string): void {
    const session = this.ports.state.getByTaskId(taskId);
    if (!session) return;
    this.stopWatcher(session.taskRunId);
    this.ports.state.remove(session.taskRunId);
  }

  async sendPrompt(
    taskId: string,
    prompt: string,
    attachments: Attachment[] = [],
  ): Promise<void> {
    const session = this.requireSession(taskId);
    const prepared = await this.ports.prompts.prepare(prompt, attachments);
    const userEvent = this.createUserEvent(prompt, prepared.eventAttachments);

    if (prepared.eventAttachments?.length) {
      this.ports.prompts.recordAttachmentEcho?.(
        session.taskRunId,
        prompt,
        prepared.eventAttachments,
      );
    }
    this.addLocalEcho(session.taskRunId, prompt, userEvent);

    try {
      await this.commandController.sendUserMessage(
        { taskId, taskRunId: session.taskRunId },
        prepared.wirePayload,
      );
    } catch (error) {
      const classification = this.ports.api.classifyCommandError(error);
      if (classification.kind === "sandbox_inactive") {
        try {
          await this.resume(taskId, session.taskRunId, prepared.wirePayload);
          return;
        } catch (resumeError) {
          this.rollbackLocalEcho(session.taskRunId, prompt, userEvent);
          throw resumeError;
        }
      }
      this.rollbackLocalEcho(session.taskRunId, prompt, userEvent);
      throw error;
    }
  }

  async resume(
    taskId: string,
    previousRunId: string,
    pendingUserMessage: string,
  ): Promise<void> {
    const freshTask = await this.ports.api.getTask(taskId);
    const previousRun = freshTask.latestRun;
    const composerConfig = this.ports.preferences.getComposerConfig(taskId);
    const updatedTask = await this.ports.api.runTask(taskId, {
      branch: previousRun?.branch ?? null,
      resumeFromRunId: previousRunId,
      pendingUserMessage,
      reasoningEffort:
        composerConfig?.reasoning ?? previousRun?.reasoningEffort ?? undefined,
      initialPermissionMode:
        composerConfig?.mode ?? previousRun?.initialPermissionMode,
      rtkEnabled: this.ports.preferences.isRtkEnabled(),
    });
    const newRunId = updatedTask.latestRun?.id;
    if (!newRunId) throw new Error("Resume run was created without an id");

    const previousSession = this.ports.state.getByRunId(previousRunId);
    if (!previousSession) throw new Error("No active session for previous run");

    this.stopWatcher(previousRunId);
    this.ports.state.remove(previousRunId);
    this.ports.state.set({
      ...previousSession,
      taskRunId: newRunId,
      status: "connecting",
      isPromptPending: true,
      awaitingPing: true,
      promptStartedAt: this.ports.time.now(),
      awaitingAgentOutput: true,
    });
    this.startWatcher(newRunId, taskId);
  }

  async sendPermissionResponse(
    taskId: string,
    response: CloudTaskPermissionResponse,
  ): Promise<void> {
    const session = this.requireSession(taskId);
    const event = this.createUserEvent(response.displayText);
    const requestId = session.cloudPermissionRequestIds?.[response.toolCallId];
    if (!requestId) {
      throw new Error("No cloud permission request id found");
    }

    this.ports.state.update(session.taskRunId, (current) => ({
      ...this.withLocalEcho(current, response.displayText, event),
      pendingPermissions: {
        ...(current.pendingPermissions ?? {}),
        ...(current.pendingPermissions?.[response.toolCallId]
          ? {
              [response.toolCallId]: {
                ...current.pendingPermissions[response.toolCallId],
                response: {
                  optionId: response.optionId,
                  displayText: response.displayText,
                  ...(response.answers ? { answers: response.answers } : {}),
                  ...(response.customInput
                    ? { customInput: response.customInput }
                    : {}),
                },
              },
            }
          : {}),
      },
    }));

    try {
      await this.commandController.respondToPermission(
        { taskId, taskRunId: session.taskRunId },
        {
          requestId,
          optionId: response.optionId,
          ...(response.answers ? { answers: response.answers } : {}),
          ...(response.customInput
            ? { customInput: response.customInput }
            : {}),
        },
      );
      this.ports.state.update(session.taskRunId, (current) => {
        const requestIds = { ...(current.cloudPermissionRequestIds ?? {}) };
        delete requestIds[response.toolCallId];
        return { ...current, cloudPermissionRequestIds: requestIds };
      });
    } catch (error) {
      this.ports.state.update(session.taskRunId, (current) => {
        const permission = current.pendingPermissions?.[response.toolCallId];
        return {
          ...this.withoutLocalEcho(current, response.displayText, event),
          pendingPermissions: permission
            ? {
                ...(current.pendingPermissions ?? {}),
                [response.toolCallId]: { ...permission, response: undefined },
              }
            : current.pendingPermissions,
          isPromptPending: false,
        };
      });
      throw error;
    }
  }

  async setConfigOption(
    taskId: string,
    configId: string,
    value: string,
  ): Promise<void> {
    const session = this.ports.state.getByTaskId(taskId);
    if (!session || session.terminalStatus) return;
    await this.commandController.setConfigOption(
      { taskId, taskRunId: session.taskRunId },
      configId,
      value,
    );
  }

  async cancelPrompt(taskId: string): Promise<boolean> {
    const session = this.ports.state.getByTaskId(taskId);
    if (!session) return false;
    try {
      await this.commandController.cancelPrompt({
        taskId,
        taskRunId: session.taskRunId,
      });
      this.ports.state.update(session.taskRunId, (current) => ({
        ...current,
        isPromptPending: false,
        awaitingPing: false,
        promptStartedAt: undefined,
        awaitingAgentOutput: false,
      }));
      return true;
    } catch (error) {
      this.ports.logger.error("Failed to cancel cloud prompt", error);
      return false;
    }
  }

  async stopRun(taskId: string): Promise<boolean> {
    const session = this.ports.state.getByTaskId(taskId);
    if (!session) return false;
    try {
      await this.runLifecycle.stopRun(
        { taskId, taskRunId: session.taskRunId },
        {
          ...session,
          activityVersion: `${session.events.length}:${session.lastEventAt ?? ""}:${session.terminalStatus ?? ""}:${session.status}`,
        },
      );
      return true;
    } catch (error) {
      this.ports.logger.error("Failed to stop cloud run", error);
      return false;
    }
  }

  async sendInterrupting(
    taskId: string,
    prompt: string,
    attachments: Attachment[] = [],
  ): Promise<void> {
    if (this.ports.state.getByTaskId(taskId)?.isPromptPending) {
      await this.cancelPrompt(taskId);
    }
    await this.sendPrompt(taskId, prompt, attachments);
  }

  async flushQueuedMessages(taskId: string): Promise<void> {
    if (this.flushingTasks.has(taskId)) return;
    this.flushingTasks.add(taskId);
    try {
      const drained = this.ports.queue.drain(taskId, { stopAtEdited: true });
      if (drained.length === 0) return;
      const combined = this.ports.queue.combine(drained);
      try {
        await this.sendInterrupting(
          taskId,
          combined.text,
          combined.attachments,
        );
      } catch (error) {
        this.ports.queue.prepend(taskId, drained);
        this.ports.logger.warn("Failed to flush cloud task queue", error);
      }
    } finally {
      this.flushingTasks.delete(taskId);
    }
  }

  flushQueuedMessagesIfIdle(taskId: string): void {
    const session = this.ports.state.getByTaskId(taskId);
    if (
      session?.status === "connected" &&
      !session.isPromptPending &&
      !session.terminalStatus &&
      !session.isCompacting &&
      this.ports.queue.get(taskId).length > 0
    ) {
      void this.flushQueuedMessages(taskId);
    }
  }

  async steerQueuedMessage(taskId: string, messageId: string): Promise<void> {
    const session = this.ports.state.getByTaskId(taskId);
    if (!session?.isPromptPending || session.isCompacting) return;
    const message = this.ports.queue
      .get(taskId)
      .find((candidate) => candidate.id === messageId);
    if (!message) return;

    this.ports.queue.remove(taskId, messageId);
    try {
      await this.sendInterrupting(taskId, message.content, message.attachments);
    } catch (error) {
      this.ports.queue.prepend(taskId, [message]);
      throw error;
    }
  }

  reconnectWatchers(): void {
    for (const handle of this.watcherHandles.values()) {
      handle.reconnectIfDisconnected();
    }
  }

  handleUpdate(taskRunId: string, update: CloudTaskUpdatePayload): void {
    if (update.kind === "error") {
      this.ports.state.update(taskRunId, (current) => ({
        ...current,
        status: "error",
        isPromptPending: false,
        lastError: update.errorMessage,
      }));
      return;
    }

    if (update.kind === "permission_request") {
      this.ports.state.update(taskRunId, (current) => ({
        ...current,
        cloudPermissionRequestIds: {
          ...(current.cloudPermissionRequestIds ?? {}),
          [update.toolCall.toolCallId]: update.requestId,
        },
        pendingPermissions: {
          ...(current.pendingPermissions ?? {}),
          [update.toolCall.toolCallId]: {
            requestId: update.requestId,
            toolCall: update.toolCall,
            options: update.options,
          },
        },
      }));
      return;
    }

    if (update.kind === "snapshot" || update.kind === "logs") {
      this.handleLogUpdate(taskRunId, update);
    }

    if (
      (update.kind === "status" || update.kind === "snapshot") &&
      update.status !== undefined &&
      isTerminalStatus(update.status)
    ) {
      this.handleTerminalUpdate(taskRunId, update.status, update.errorMessage);
    }
  }

  private startWatcher(taskRunId: string, taskId: string): void {
    if (this.watcherHandles.has(taskRunId)) return;
    this.watcherHandles.set(
      taskRunId,
      this.ports.watchers.create({
        taskId,
        runId: taskRunId,
        onUpdate: (update) => this.handleUpdate(taskRunId, update),
      }),
    );
  }

  private stopWatcher(taskRunId: string): void {
    this.watcherHandles.get(taskRunId)?.stop();
    this.watcherHandles.delete(taskRunId);
  }

  private handleLogUpdate(
    taskRunId: string,
    update: Extract<CloudTaskUpdatePayload, { kind: "snapshot" | "logs" }>,
  ): void {
    const isSnapshot = update.kind === "snapshot";
    const existing = this.ports.state.getByRunId(taskRunId);
    if (!existing) return;
    const echoSet = isSnapshot
      ? new Set<string>()
      : new Set(existing.localUserEchoes ?? []);
    const entries = isSnapshot
      ? update.newEntries
      : dedupAgainstLocalEchoes(update.newEntries, echoSet);
    const events = convertStoredEntriesToPortableSessionEvents(entries);
    if (isSnapshot) {
      this.ports.prompts.reinjectSnapshotAttachments?.(taskRunId, events);
    }
    const analysis = analyzeEntries(entries, isSnapshot ? new Set() : echoSet);
    const wasPromptPending = existing.isPromptPending;

    this.ports.state.update(taskRunId, (current) => {
      let isPromptPending = current.isPromptPending;
      if (analysis.externalUserMessageCount > 0) isPromptPending = true;
      if (analysis.hasTurnEnd || analysis.agentMessageFinalized) {
        isPromptPending = false;
      }
      return {
        ...current,
        events: isSnapshot ? events : [...current.events, ...events],
        status: "connected",
        isPromptPending,
        awaitingPing:
          !isSnapshot && (analysis.hasTurnEnd || analysis.agentMessageFinalized)
            ? false
            : current.awaitingPing,
        awaitingAgentOutput:
          current.awaitingAgentOutput && !analysis.hasVisibleAgentOutput,
        isCompacting: analysis.compacting ?? current.isCompacting,
        localUserEchoes: echoSet.size > 0 ? echoSet : undefined,
        lastEventAt:
          events.length > 0 ? this.ports.time.now() : current.lastEventAt,
      };
    });

    if (!isSnapshot && existing.awaitingPing) {
      const kind = notificationKindForAnalysis(analysis);
      if (kind) this.emitCompletion(existing, kind);
    }

    const after = this.ports.state.getByRunId(taskRunId);
    if (
      !isSnapshot &&
      wasPromptPending &&
      after &&
      !after.isPromptPending &&
      after.status === "connected" &&
      this.ports.queue.get(after.taskId).length > 0
    ) {
      this.ports.time.defer(() => {
        void this.flushQueuedMessages(after.taskId);
      });
    }
  }

  private handleTerminalUpdate(
    taskRunId: string,
    status: string,
    errorMessage?: string | null,
  ): void {
    const session = this.ports.state.getByRunId(taskRunId);
    if (!session) return;
    const terminalStatus = mapTerminalStatus(status);
    this.ports.state.update(taskRunId, (current) => ({
      ...current,
      isPromptPending: false,
      terminalStatus,
      lastError: errorMessage ?? null,
      awaitingPing: false,
    }));
    if (session.awaitingPing) {
      this.emitCompletion(
        session,
        terminalStatus === "failed" ? "task_failed" : "turn_complete",
      );
    }
  }

  private emitCompletion(
    session: CloudTaskSession,
    kind: CloudTaskSessionNotificationKind,
  ): void {
    void this.ports.effects.onCompletion({
      taskId: session.taskId,
      taskRunId: session.taskRunId,
      promptStartedAt: session.promptStartedAt,
    });
    void this.ports.effects.onNotification({
      taskId: session.taskId,
      taskRunId: session.taskRunId,
      kind,
    });
  }

  private requireSession(taskId: string): CloudTaskSession {
    const session = this.ports.state.getByTaskId(taskId);
    if (!session) throw new Error("No active session for task");
    return session;
  }

  private createUserEvent(
    text: string,
    attachments?: CloudTaskPreparedPrompt["eventAttachments"],
  ): PortableSessionEvent {
    return {
      type: "session_update",
      ts: this.ports.time.now(),
      notification: {
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text },
          ...(attachments?.length ? { attachments } : {}),
        },
      },
    };
  }

  private addLocalEcho(
    taskRunId: string,
    text: string,
    event: PortableSessionEvent,
  ): void {
    this.ports.state.update(taskRunId, (session) =>
      this.withLocalEcho(session, text, event),
    );
  }

  private withLocalEcho(
    session: CloudTaskSession,
    text: string,
    event: PortableSessionEvent,
  ): CloudTaskSession {
    const localUserEchoes = new Set(session.localUserEchoes ?? []);
    localUserEchoes.add(text);
    return {
      ...session,
      events: [...session.events, event],
      localUserEchoes,
      isPromptPending: true,
      awaitingPing: true,
      promptStartedAt: event.ts,
      awaitingAgentOutput: true,
    };
  }

  private rollbackLocalEcho(
    taskRunId: string,
    text: string,
    event: PortableSessionEvent,
  ): void {
    this.ports.state.update(taskRunId, (session) =>
      this.withoutLocalEcho(session, text, event),
    );
  }

  private withoutLocalEcho(
    session: CloudTaskSession,
    text: string,
    event: PortableSessionEvent,
  ): CloudTaskSession {
    const localUserEchoes = new Set(session.localUserEchoes ?? []);
    localUserEchoes.delete(text);
    return {
      ...session,
      events: session.events.filter((candidate) => candidate !== event),
      localUserEchoes,
      isPromptPending: false,
    };
  }
}

function analyzeEntries(
  entries: readonly StoredLogEntry[],
  localUserEchoes: ReadonlySet<string>,
): EntryAnalysis {
  const analysis: EntryAnalysis = {
    hasTurnEnd: false,
    hasAwaitingUserInput: false,
    hasTurnCompleted: false,
    hasTurnFailed: false,
    hasVisibleAgentOutput: false,
    externalUserMessageCount: 0,
    agentMessageFinalized: false,
  };
  for (const entry of entries) {
    const method = entry.notification?.method;
    if (method && turnEndMethods.has(method)) {
      analysis.hasTurnEnd = true;
      analysis.hasAwaitingUserInput ||=
        method === "_posthog/awaiting_user_input";
      analysis.hasTurnCompleted ||=
        method === "_posthog/turn_complete" ||
        method === "_posthog/task_complete";
      analysis.hasTurnFailed ||= method === "_posthog/error";
    }
    if (method === "_posthog/status") {
      const params = entry.notification?.params as
        | { status?: string; isComplete?: boolean }
        | undefined;
      if (params?.status === "compacting")
        analysis.compacting = !params.isComplete;
    }
    if (method === "_posthog/compact_boundary") analysis.compacting = false;
    if (entry.type !== "notification" || method !== "session/update") continue;
    const notification = entry.notification?.params as
      | PortableSessionNotification
      | undefined;
    const update = notification?.update;
    if (
      update?.sessionUpdate &&
      visibleAgentSessionUpdates.has(update.sessionUpdate)
    ) {
      analysis.hasVisibleAgentOutput = true;
    }
    if (update?.sessionUpdate === "agent_message") {
      analysis.agentMessageFinalized = true;
    }
    if (
      update?.sessionUpdate === "user_message_chunk" &&
      update.content?.text &&
      !localUserEchoes.has(update.content.text)
    ) {
      analysis.externalUserMessageCount += 1;
    }
  }
  return analysis;
}

function dedupAgainstLocalEchoes(
  entries: readonly StoredLogEntry[],
  localUserEchoes: Set<string>,
): StoredLogEntry[] {
  if (localUserEchoes.size === 0) return [...entries];
  return entries.filter((entry) => {
    if (
      entry.type !== "notification" ||
      entry.notification?.method !== "session/update"
    ) {
      return true;
    }
    const notification = entry.notification.params as
      | PortableSessionNotification
      | undefined;
    const update = notification?.update;
    const text = update?.content?.text;
    if (update?.sessionUpdate !== "user_message_chunk" || !text) return true;
    if (!localUserEchoes.has(text)) return true;
    localUserEchoes.delete(text);
    return false;
  });
}

function notificationKindForAnalysis(
  analysis: EntryAnalysis,
): CloudTaskSessionNotificationKind | undefined {
  if (analysis.hasAwaitingUserInput) return "awaiting_user_input";
  if (analysis.hasTurnCompleted) return "turn_complete";
  if (analysis.hasTurnFailed) return "task_failed";
  return undefined;
}

function mapTerminalStatus(status: string): CloudTaskSessionTerminalStatus {
  return status === "completed" ? "completed" : "failed";
}
