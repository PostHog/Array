import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { AppState } from "react-native";
import { create } from "zustand";
import { usePreferencesStore } from "@/features/preferences/stores/preferencesStore";
import { logger } from "@/lib/logger";
import {
  CloudCommandError,
  fetchS3Logs,
  getTask,
  getTaskRun,
  runTaskInCloud,
  sendCloudCommand,
} from "../api";
import type {
  SessionEvent,
  SessionNotification,
  StoredLogEntry,
  Task,
  WatchMissionCommand,
} from "../types";
import {
  convertRawEntriesToEvents,
  parseSessionLogs,
} from "../utils/parseSessionLogs";
import { playMeepSound } from "../utils/sounds";
import { createWatchMissionEnvelope } from "../utils/watchMissionControl";
import {
  publishWatchMissionEnvelope,
  sendUrgentWatchMissionUpdate,
  subscribeToWatchMissionCommands,
} from "../watchMissionControlBridge";

// Infer whether the agent is actively working or idle (waiting for user input).
// Primary signal: _posthog/turn_complete or _posthog/task_complete in raw log
// entries. Fallback: session update notification heuristic for older logs.
function inferAgentIsIdle(
  rawEntries: StoredLogEntry[],
  notifications: SessionNotification[],
): boolean {
  // Check raw entries for explicit turn/task completion signals
  for (let i = rawEntries.length - 1; i >= 0; i--) {
    const method = rawEntries[i].notification?.method;
    if (
      method === "_posthog/turn_complete" ||
      method === "_posthog/task_complete"
    ) {
      return true;
    }
    // If we hit a client-direction entry (user message), the agent hasn't
    // completed a turn since the last user input.
    if (rawEntries[i].direction === "client") break;
  }

  // Fallback: check session update notifications for agent responses
  for (let i = notifications.length - 1; i >= 0; i--) {
    const su = notifications[i].update?.sessionUpdate;
    if (su === "agent_message" || su === "agent_message_chunk") {
      return true;
    }
    if (
      su === "user_message_chunk" ||
      su === "tool_call" ||
      su === "tool_call_update" ||
      su === "agent_thought_chunk"
    ) {
      return false;
    }
  }
  return false;
}

const CLOUD_POLLING_INTERVAL_MS = 500;

export interface TaskSession {
  taskRunId: string;
  taskId: string;
  events: SessionEvent[];
  status: "connecting" | "connected" | "disconnected" | "error";
  isPromptPending: boolean;
  logUrl: string;
  processedLineCount: number;
  processedHashes?: Set<string>;
  // Content of user prompts echoed locally (before the agent writes them to
  // the log). Used by polling to dedup the canonical copy against the echo.
  localUserEchoes?: Set<string>;
  // Terminal backend status for this run, populated by the status-check
  // poller so the UI can surface "Run failed" / "Run completed".
  terminalStatus?: "failed" | "completed";
  lastError?: string | null;
  // True when the user initiated work (new task, sendPrompt, resume) and
  // we should play a sound when control returns. False when reconnecting
  // to an already-running task to avoid spurious pings.
  awaitingPing?: boolean;
  // True after a user prompt is sent, cleared when the first piece of
  // agent output (tool call, message, etc.) arrives from polling.
  awaitingAgentOutput?: boolean;
  // Timestamp of the last new event received via polling. Used to detect
  // stale local sessions (desktop stopped syncing).
  lastEventAt?: number;
}

interface TaskSessionStore {
  sessions: Record<string, TaskSession>;
  watchMissionTasks: Record<string, Task>;
  activeWatchTaskId?: string;

  connectToTask: (task: Task) => Promise<void>;
  disconnectFromTask: (taskId: string) => void;
  setActiveWatchTask: (taskId?: string) => void;
  registerWatchTask: (task: Task) => void;
  sendPrompt: (taskId: string, prompt: string) => Promise<void>;
  sendPermissionResponse: (
    taskId: string,
    args: {
      toolCallId: string;
      optionId: string;
      answers?: Record<string, string>;
      customInput?: string;
      displayText: string;
    },
  ) => Promise<void>;
  cancelPrompt: (taskId: string) => Promise<boolean>;
  retryTaskFromWatch: (taskId: string, taskRunId?: string) => Promise<void>;
  handleWatchCommand: (command: WatchMissionCommand) => Promise<void>;
  getSessionForTask: (taskId: string) => TaskSession | undefined;

  _startCloudPolling: (taskRunId: string, logUrl: string) => void;
  _stopCloudPolling: (taskRunId: string) => void;
  _resumeCloudRun: (
    taskId: string,
    previousRunId: string,
    prompt: string,
  ) => Promise<void>;
}

const cloudPollers = new Map<string, ReturnType<typeof setInterval>>();
const connectAttempts = new Set<string>();
// Guard against overlapping poll ticks — if a fetch takes >500ms, the next
// interval fires while the previous is still running, causing both to read
// the same processedLineCount and produce duplicate events.
const pollInFlight = new Set<string>();
// Timestamps for when each poll tick started — used to force-clear stuck ticks.
const pollInFlightSince = new Map<string, number>();
const POLL_IN_FLIGHT_TIMEOUT_MS = 30_000;
// Tick counts per task run used to throttle backend task-run status polling.
const pollTicks = new Map<string, number>();
// How many S3 polling ticks between each backend task-run status check.
const STATUS_CHECK_TICK_INTERVAL = 5;
const WATCH_SNAPSHOT_DEBOUNCE_MS = 250;
const TRANSIENT_CLOUD_COMMAND_STATUSES = new Set([502, 503, 504]);
const VISIBLE_AGENT_SESSION_UPDATES = new Set([
  "agent_message_chunk",
  "agent_message",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
]);

let watchPublishTimeout: ReturnType<typeof setTimeout> | null = null;
let watchPublishUrgent = false;
let watchCommandUnsubscribe: (() => void) | null = null;

function sessionUpdateType(event: SessionEvent): string | undefined {
  return event.type === "session_update"
    ? event.notification.update?.sessionUpdate
    : undefined;
}

function isVisibleAgentOutputEvent(event: SessionEvent): boolean {
  const updateType = sessionUpdateType(event);
  return !!updateType && VISIBLE_AGENT_SESSION_UPDATES.has(updateType);
}

function isTransientCloudCommandError(
  error: unknown,
): error is CloudCommandError {
  return (
    error instanceof CloudCommandError &&
    TRANSIENT_CLOUD_COMMAND_STATUSES.has(error.status)
  );
}

function macTaskUrl(command: {
  taskId: string;
  taskRunId?: string;
  url?: string;
}) {
  if (command.url) return command.url;
  const runPath = command.taskRunId ? `/run/${command.taskRunId}` : "";
  return `posthog-code://task/${command.taskId}${runPath}`;
}

function buildWatchMissionEnvelopeFromStore() {
  const state = useTaskSessionStore.getState();
  const sessionsByTaskId: Record<string, TaskSession | undefined> = {};
  for (const session of Object.values(state.sessions)) {
    sessionsByTaskId[session.taskId] = session;
  }
  return createWatchMissionEnvelope(
    Object.values(state.watchMissionTasks),
    sessionsByTaskId,
    state.activeWatchTaskId,
  );
}

function scheduleWatchMissionPublish(options: { urgent?: boolean } = {}) {
  if (options.urgent) watchPublishUrgent = true;
  if (watchPublishTimeout) return;

  watchPublishTimeout = setTimeout(() => {
    watchPublishTimeout = null;
    const urgent = watchPublishUrgent;
    watchPublishUrgent = false;
    const envelope = buildWatchMissionEnvelopeFromStore();
    const publish = urgent
      ? sendUrgentWatchMissionUpdate(envelope)
      : publishWatchMissionEnvelope(envelope);
    publish.catch((error) => {
      logger.warn("Failed to publish watch mission envelope", { error });
    });
  }, WATCH_SNAPSHOT_DEBOUNCE_MS);
}

function ensureWatchCommandSubscription() {
  if (watchCommandUnsubscribe) return;
  watchCommandUnsubscribe = subscribeToWatchMissionCommands((command) => {
    useTaskSessionStore
      .getState()
      .handleWatchCommand(command)
      .catch((error) => {
        logger.warn("Failed to handle watch mission command", { error });
      });
  });
}

export const useTaskSessionStore = create<TaskSessionStore>((set, get) => ({
  sessions: {},
  watchMissionTasks: {},

  setActiveWatchTask: (taskId?: string) => {
    ensureWatchCommandSubscription();
    set({ activeWatchTaskId: taskId });
    scheduleWatchMissionPublish();
  },

  registerWatchTask: (task: Task) => {
    ensureWatchCommandSubscription();
    set((state) => ({
      watchMissionTasks: {
        ...state.watchMissionTasks,
        [task.id]: task,
      },
      activeWatchTaskId: state.activeWatchTaskId ?? task.id,
    }));
    scheduleWatchMissionPublish();
  },

  connectToTask: async (task: Task) => {
    ensureWatchCommandSubscription();
    get().registerWatchTask(task);
    const taskId = task.id;
    const latestRunId = task.latest_run?.id;
    const latestRunLogUrl = task.latest_run?.log_url;

    if (connectAttempts.has(taskId)) {
      logger.debug("Connection already in progress", { taskId });
      return;
    }

    const existing = get().getSessionForTask(taskId);
    if (existing && existing.status === "connected") {
      logger.debug("Already connected to task", { taskId });
      return;
    }

    connectAttempts.add(taskId);

    try {
      if (!latestRunId || !latestRunLogUrl) {
        logger.debug("Task has no run yet, starting cloud run", { taskId });
        const updatedTask = await runTaskInCloud(taskId);
        const newRunId = updatedTask.latest_run?.id;
        const newLogUrl = updatedTask.latest_run?.log_url;

        if (!newRunId || !newLogUrl) {
          logger.error("Failed to start cloud run");
          return;
        }

        set((state) => ({
          watchMissionTasks: {
            ...state.watchMissionTasks,
            [taskId]: updatedTask,
          },
          sessions: {
            ...state.sessions,
            [newRunId]: {
              taskRunId: newRunId,
              taskId,
              events: [],
              status: "connected",
              isPromptPending: true,
              logUrl: newLogUrl,
              processedLineCount: 0,
              awaitingPing: true,
              awaitingAgentOutput: true,
            },
          },
        }));
        scheduleWatchMissionPublish();

        get()._startCloudPolling(newRunId, newLogUrl);
        logger.debug("Started new cloud session", {
          taskId,
          taskRunId: newRunId,
        });
        return;
      }

      logger.debug("Fetching cloud session history from S3", {
        taskId,
        latestRunId,
      });
      const content = await fetchS3Logs(latestRunLogUrl);
      const { notifications, rawEntries } = parseSessionLogs(content);
      logger.debug("Loaded cloud historical logs", {
        notifications: notifications.length,
        rawEntries: rawEntries.length,
        backendStatus: task.latest_run?.status,
      });

      const historicalEvents = convertRawEntriesToEvents(
        rawEntries,
        notifications,
      );

      // Terminal runs (completed/failed) always clear isPromptPending.
      // For non-terminal runs we infer idle vs working from the log shape
      // because the backend has no "waiting_for_input" status.
      const backendStatus = task.latest_run?.status;
      const isTerminal =
        backendStatus === "completed" || backendStatus === "failed";
      const terminalStatus: "completed" | "failed" | undefined = isTerminal
        ? (backendStatus as "completed" | "failed")
        : undefined;
      const lastError = isTerminal
        ? (task.latest_run?.error_message ?? null)
        : null;

      const agentIsIdle = inferAgentIsIdle(rawEntries, notifications);
      const isPromptPending = isTerminal ? false : !agentIsIdle;

      set((state) => ({
        watchMissionTasks: {
          ...state.watchMissionTasks,
          [taskId]: task,
        },
        sessions: {
          ...state.sessions,
          [latestRunId]: {
            taskRunId: latestRunId,
            taskId,
            events: historicalEvents,
            status: "connected",
            isPromptPending,
            logUrl: latestRunLogUrl,
            processedLineCount: rawEntries.length,
            terminalStatus,
            lastError,
            // Show "Connecting/Thinking" for active non-terminal runs
            // that haven't produced visible agent output yet.
            awaitingAgentOutput:
              isPromptPending &&
              !historicalEvents.some(isVisibleAgentOutputEvent),
          },
        },
      }));
      scheduleWatchMissionPublish({ urgent: !!terminalStatus });

      get()._startCloudPolling(latestRunId, latestRunLogUrl);
      logger.debug("Connected to cloud session", {
        taskId,
        latestRunId,
        backendStatus,
        isTerminal,
      });
    } catch (error) {
      logger.error("Failed to connect to task", error);
    } finally {
      connectAttempts.delete(taskId);
    }
  },

  disconnectFromTask: (taskId: string) => {
    const session = get().getSessionForTask(taskId);
    if (!session) return;

    get()._stopCloudPolling(session.taskRunId);

    set((state) => {
      const { [session.taskRunId]: _, ...rest } = state.sessions;
      return { sessions: rest };
    });
    scheduleWatchMissionPublish();
    logger.debug("Disconnected from task", { taskId });
  },

  sendPrompt: async (taskId: string, prompt: string) => {
    const session = get().getSessionForTask(taskId);
    if (!session) {
      throw new Error("No active session for task");
    }

    // Mobile is a dumb relay for local runs — always push the message to
    // the backend and let the desktop decide whether/when to process it.
    // No local gating, no client-side queueing.

    // Local echo for immediate UX feedback — polling will re-surface the
    // canonical copy once the agent writes it to the log; any duplicate is
    // removed by content-based dedup in the polling loop below.
    const ts = Date.now();
    const userEvent: SessionEvent = {
      type: "session_update",
      ts,
      notification: {
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: prompt },
        },
      },
    };

    set((state) => {
      const current = state.sessions[session.taskRunId];
      const nextLocalEchoes = new Set(current.localUserEchoes ?? []);
      nextLocalEchoes.add(prompt);
      return {
        sessions: {
          ...state.sessions,
          [session.taskRunId]: {
            ...current,
            events: [...current.events, userEvent],
            localUserEchoes: nextLocalEchoes,
            isPromptPending: true,
            awaitingPing: true,
            awaitingAgentOutput: true,
          },
        },
      };
    });
    scheduleWatchMissionPublish();

    try {
      await sendCloudCommand(taskId, session.taskRunId, "user_message", {
        content: prompt,
      });
      logger.debug("Sent cloud command user_message", {
        taskId,
        runId: session.taskRunId,
      });
    } catch (err) {
      // Transient server errors (504 gateway timeout, etc.) — the sandbox
      // may still be alive, just temporarily unreachable.  Roll back so the
      // user can retry but don't attempt a full resume.
      if (isTransientCloudCommandError(err)) {
        logger.warn("Transient server error sending prompt, rolling back", {
          status: err.status,
          taskId,
        });
        set((state) => {
          const current = state.sessions[session.taskRunId];
          if (!current) return state;
          const nextLocalEchoes = new Set(current.localUserEchoes ?? []);
          nextLocalEchoes.delete(prompt);
          return {
            sessions: {
              ...state.sessions,
              [session.taskRunId]: {
                ...current,
                events: current.events.filter((e) => e !== userEvent),
                localUserEchoes: nextLocalEchoes,
                isPromptPending: false,
              },
            },
          };
        });
        scheduleWatchMissionPublish();
        throw err;
      }

      // Sandbox for this run has shut down — create a resume run on the
      // backend and swap the local session to the new run id.
      let rollbackError: unknown = err;
      if (err instanceof CloudCommandError && err.isSandboxInactive()) {
        logger.info("Sandbox inactive, creating resume run", {
          taskId,
          previousRunId: session.taskRunId,
        });
        try {
          await get()._resumeCloudRun(taskId, session.taskRunId, prompt);
          return;
        } catch (resumeErr) {
          logger.error("Failed to resume cloud run", resumeErr);
          rollbackError = resumeErr;
        }
      }

      // Roll back the local echo + pending state so the user can retry.
      set((state) => {
        const current = state.sessions[session.taskRunId];
        if (!current) return state;
        const nextLocalEchoes = new Set(current.localUserEchoes ?? []);
        nextLocalEchoes.delete(prompt);
        return {
          sessions: {
            ...state.sessions,
            [session.taskRunId]: {
              ...current,
              events: current.events.filter((e) => e !== userEvent),
              localUserEchoes: nextLocalEchoes,
              isPromptPending: false,
            },
          },
        };
      });
      scheduleWatchMissionPublish();
      throw rollbackError;
    }
  },

  // Resolve an outstanding requestPermission on the desktop/agent side
  // (e.g. AskUserQuestion). Unlike sendPrompt, this never queues — a
  // permission reply only makes sense while the agent is paused inside
  // requestPermission, and it completes an existing turn rather than
  // starting a new one.
  sendPermissionResponse: async (taskId, args) => {
    const session = get().getSessionForTask(taskId);
    if (!session) {
      throw new Error("No active session for task");
    }

    const ts = Date.now();
    const userEvent: SessionEvent = {
      type: "session_update",
      ts,
      notification: {
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: args.displayText },
        },
      },
    };

    set((state) => {
      const current = state.sessions[session.taskRunId];
      if (!current) return state;
      const nextLocalEchoes = new Set(current.localUserEchoes ?? []);
      nextLocalEchoes.add(args.displayText);
      return {
        sessions: {
          ...state.sessions,
          [session.taskRunId]: {
            ...current,
            events: [...current.events, userEvent],
            localUserEchoes: nextLocalEchoes,
            isPromptPending: true,
            awaitingPing: true,
            awaitingAgentOutput: true,
          },
        },
      };
    });
    scheduleWatchMissionPublish();

    try {
      await sendCloudCommand(taskId, session.taskRunId, "permission_response", {
        toolCallId: args.toolCallId,
        optionId: args.optionId,
        ...(args.answers ? { answers: args.answers } : {}),
        ...(args.customInput ? { customInput: args.customInput } : {}),
      });
      logger.debug("Sent permission_response", {
        taskId,
        runId: session.taskRunId,
        toolCallId: args.toolCallId,
      });
    } catch (err) {
      logger.error("Failed to send permission_response", err);
      // Roll back the optimistic state so the UI reflects reality.
      set((state) => {
        const current = state.sessions[session.taskRunId];
        if (!current) return state;
        const nextLocalEchoes = new Set(current.localUserEchoes ?? []);
        nextLocalEchoes.delete(args.displayText);
        return {
          sessions: {
            ...state.sessions,
            [session.taskRunId]: {
              ...current,
              events: current.events.filter((e) => e !== userEvent),
              localUserEchoes: nextLocalEchoes,
              isPromptPending: false,
            },
          },
        };
      });
      scheduleWatchMissionPublish();
      throw err;
    }
  },

  cancelPrompt: async (taskId: string) => {
    const session = get().getSessionForTask(taskId);
    if (!session) return false;

    try {
      await sendCloudCommand(taskId, session.taskRunId, "cancel");
      logger.debug("Sent cancel command", {
        taskId,
        runId: session.taskRunId,
      });

      set((state) => ({
        sessions: {
          ...state.sessions,
          [session.taskRunId]: {
            ...state.sessions[session.taskRunId],
            isPromptPending: false,
          },
        },
      }));
      scheduleWatchMissionPublish({ urgent: true });
      return true;
    } catch (error) {
      logger.error("Failed to send cancel request", error);
      return false;
    }
  },

  retryTaskFromWatch: async (taskId: string, taskRunId?: string) => {
    const currentTask =
      get().watchMissionTasks[taskId] ?? (await getTask(taskId));
    const resumeFromRunId = taskRunId ?? currentTask.latest_run?.id;

    get().disconnectFromTask(taskId);
    const updatedTask = await runTaskInCloud(taskId, {
      resumeFromRunId,
    });

    get().registerWatchTask(updatedTask);
    await get().connectToTask(updatedTask);
    scheduleWatchMissionPublish({ urgent: true });
  },

  handleWatchCommand: async (command: WatchMissionCommand) => {
    switch (command.type) {
      case "approval_response":
        await get().sendPermissionResponse(command.taskId, {
          toolCallId: command.toolCallId,
          optionId: command.optionId,
          answers: command.answers,
          customInput: command.customInput,
          displayText: command.displayText,
        });
        break;
      case "stop":
        await get().cancelPrompt(command.taskId);
        break;
      case "retry":
        await get().retryTaskFromWatch(command.taskId, command.taskRunId);
        break;
      case "open_phone":
      case "view_diff":
        await Linking.openURL(
          command.url ?? `posthog://task/${command.taskId}`,
        );
        break;
      case "open_mac":
        await Linking.openURL(macTaskUrl(command));
        break;
    }
  },

  getSessionForTask: (taskId: string) => {
    return Object.values(get().sessions).find((s) => s.taskId === taskId);
  },

  _startCloudPolling: (taskRunId: string, logUrl: string) => {
    if (cloudPollers.has(taskRunId)) return;
    logger.debug("Starting cloud S3 polling", { taskRunId });

    const pollS3 = async () => {
      // Skip if previous tick is still in flight — but force-clear if stuck
      if (pollInFlight.has(taskRunId)) {
        const startedAt = pollInFlightSince.get(taskRunId) ?? 0;
        if (Date.now() - startedAt < POLL_IN_FLIGHT_TIMEOUT_MS) return;
        logger.warn("Force-clearing stuck pollInFlight", { taskRunId });
        pollInFlight.delete(taskRunId);
        pollInFlightSince.delete(taskRunId);
      }
      pollInFlight.add(taskRunId);
      pollInFlightSince.set(taskRunId, Date.now());

      try {
        const session = get().sessions[taskRunId];
        if (!session) {
          get()._stopCloudPolling(taskRunId);
          return;
        }

        // Check backend status periodically, or every tick while the agent
        // is pending (so "Thinking..." clears promptly when the run finishes).
        const tick = (pollTicks.get(taskRunId) ?? 0) + 1;
        pollTicks.set(taskRunId, tick);
        const shouldCheckStatus =
          session.isPromptPending || tick % STATUS_CHECK_TICK_INTERVAL === 0;
        if (shouldCheckStatus) {
          try {
            const run = await getTaskRun(session.taskId, taskRunId);
            logger.debug("Status check", {
              taskRunId,
              status: run.status,
              error: run.error_message,
            });
            if (run.status === "failed" || run.status === "completed") {
              logger.debug("Backend run reached terminal status", {
                taskRunId,
                status: run.status,
                error: run.error_message,
              });
              const shouldPing =
                get().sessions[taskRunId]?.awaitingPing ?? false;
              set((state) => {
                const current = state.sessions[taskRunId];
                if (!current) return state;
                return {
                  sessions: {
                    ...state.sessions,
                    [taskRunId]: {
                      ...current,
                      isPromptPending: false,
                      terminalStatus: run.status as "failed" | "completed",
                      lastError: run.error_message,
                      awaitingPing: false,
                    },
                  },
                };
              });
              scheduleWatchMissionPublish({ urgent: true });
              if (shouldPing && usePreferencesStore.getState().pingsEnabled) {
                playMeepSound().catch(() => {});
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success,
                );
              }
            }
          } catch (statusErr) {
            logger.warn("Failed to fetch task run status", {
              error: statusErr,
            });
          }
        }

        const text = await fetchS3Logs(logUrl);
        if (!text) return;

        const lines = text.trim().split("\n").filter(Boolean);
        const processedCount = session.processedLineCount ?? 0;

        if (lines.length > processedCount) {
          const newLines = lines.slice(processedCount);
          logger.debug("Poll picked up new log lines", {
            taskRunId,
            newLineCount: newLines.length,
            totalLines: lines.length,
          });
          const currentHashes = new Set(session.processedHashes ?? []);
          const remainingLocalEchoes = new Set(session.localUserEchoes ?? []);
          // Collect all new events in a batch, then do a single store
          // update. This prevents N re-renders per poll tick.
          const batchedEvents: SessionEvent[] = [];
          let receivedAgentMessage = false;
          // Track when a user_message_chunk arrives that wasn't sent from
          // this device — means someone prompted from the desktop app.
          let receivedExternalUserMessage = false;

          for (const line of newLines) {
            try {
              const entry = JSON.parse(line);
              const ts = entry.timestamp
                ? new Date(entry.timestamp).getTime()
                : Date.now();

              // Build a dedup hash specific enough to distinguish different
              // events at the same timestamp. For session/update entries,
              // include the update type, toolCallId, and status so that a
              // tool_call and its tool_call_update don't collide.
              const params = entry.notification?.params;
              const suDetail = params?.update
                ? `-${params.update.sessionUpdate ?? ""}-${params.update.toolCallId ?? ""}-${params.update.status ?? ""}`
                : `-${entry.direction ?? ""}`;
              const hash = `${entry.timestamp ?? ""}-${entry.notification?.method ?? ""}${suDetail}`;
              if (currentHashes.has(hash)) {
                continue;
              }
              currentHashes.add(hash);

              // Check for local echo dedup BEFORE pushing any events for
              // this entry — otherwise the acp_message duplicate gets in.
              if (
                entry.type === "notification" &&
                entry.notification?.method === "session/update" &&
                entry.notification?.params
              ) {
                const params = entry.notification.params as SessionNotification;
                const sessionUpdate = params?.update?.sessionUpdate;

                if (sessionUpdate === "user_message_chunk") {
                  const text = params?.update?.content?.text;
                  if (text && remainingLocalEchoes.has(text)) {
                    remainingLocalEchoes.delete(text);
                    continue;
                  }
                  // User message not from this device (e.g. desktop app)
                  receivedExternalUserMessage = true;
                }
              }

              batchedEvents.push({
                type: "acp_message",
                direction: entry.direction ?? "agent",
                ts,
                message: entry.notification,
              });

              if (
                entry.type === "notification" &&
                (entry.notification?.method === "_posthog/turn_complete" ||
                  entry.notification?.method === "_posthog/task_complete" ||
                  entry.notification?.method === "_posthog/error" ||
                  // Agent explicitly blocked on a user reply (e.g. a question
                  // tool invoked via requestPermission). Treat this as a
                  // turn boundary so the input UI unblocks — otherwise the
                  // user's answer would be stuck in the "queue while busy"
                  // path in sendPrompt.
                  entry.notification?.method === "_posthog/awaiting_user_input")
              ) {
                receivedAgentMessage = true;
              }

              if (
                entry.type === "notification" &&
                entry.notification?.method === "session/update" &&
                entry.notification?.params
              ) {
                const params = entry.notification.params as SessionNotification;
                const sessionUpdate = params?.update?.sessionUpdate;

                batchedEvents.push({
                  type: "session_update",
                  ts,
                  notification: params,
                });

                // agent_message (finalized, non-chunk) is a reasonable proxy
                // for turn completion — it's emitted once the full response
                // is assembled. Chunks and thoughts fire mid-turn and are NOT
                // reliable. The proper signal is _posthog/turn_complete but
                // it's not yet written to S3 logs by the server.
                if (sessionUpdate === "agent_message") {
                  receivedAgentMessage = true;
                }
              }
            } catch {
              // Skip invalid JSON
            }
          }

          // Determine if we should ping. If an external user message armed
          // the ping in this same batch, honour it even though the store
          // hasn't updated yet.
          const wasAwaitingPing =
            get().sessions[taskRunId]?.awaitingPing ?? false;
          const shouldPingAfterBatch =
            receivedAgentMessage &&
            (wasAwaitingPing || receivedExternalUserMessage);
          set((state) => {
            const current = state.sessions[taskRunId];
            if (!current) return state;

            // Determine isPromptPending: external user message starts work,
            // turn/task completion ends it.
            let nextIsPromptPending = current.isPromptPending;
            if (receivedExternalUserMessage) nextIsPromptPending = true;
            if (receivedAgentMessage) nextIsPromptPending = false;

            // awaitingPing: arm when work starts (even from another device),
            // disarm when it completes and the ping fires.
            let nextAwaitingPing = current.awaitingPing;
            if (receivedExternalUserMessage && !current.awaitingPing) {
              nextAwaitingPing = true;
            }
            if (receivedAgentMessage) nextAwaitingPing = false;

            // Clear awaitingAgentOutput once a visibly-rendered event arrives
            // (agent message, thought, tool call) — not just any non-user event.
            const hasVisibleAgentOutput = batchedEvents.some(
              isVisibleAgentOutputEvent,
            );
            const nextAwaitingAgentOutput =
              current.awaitingAgentOutput && !hasVisibleAgentOutput;

            return {
              sessions: {
                ...state.sessions,
                [taskRunId]: {
                  ...current,
                  events:
                    batchedEvents.length > 0
                      ? [...current.events, ...batchedEvents]
                      : current.events,
                  processedLineCount: lines.length,
                  processedHashes: currentHashes,
                  localUserEchoes:
                    remainingLocalEchoes.size > 0
                      ? remainingLocalEchoes
                      : undefined,
                  isPromptPending: nextIsPromptPending,
                  awaitingPing: nextAwaitingPing,
                  awaitingAgentOutput: nextAwaitingAgentOutput,
                  lastEventAt:
                    batchedEvents.length > 0 ? Date.now() : current.lastEventAt,
                },
              },
            };
          });
          scheduleWatchMissionPublish({
            urgent:
              shouldPingAfterBatch ||
              batchedEvents.some(
                (event) => sessionUpdateType(event) === "tool_call",
              ),
          });
          if (
            shouldPingAfterBatch &&
            usePreferencesStore.getState().pingsEnabled
          ) {
            playMeepSound().catch(() => {});
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }
      } catch (err) {
        logger.warn("Cloud polling error", { error: err });
      } finally {
        pollInFlight.delete(taskRunId);
        pollInFlightSince.delete(taskRunId);
      }
    };

    pollS3();
    const interval = setInterval(pollS3, CLOUD_POLLING_INTERVAL_MS);
    cloudPollers.set(taskRunId, interval);
  },

  _stopCloudPolling: (taskRunId: string) => {
    const interval = cloudPollers.get(taskRunId);
    if (interval) {
      clearInterval(interval);
      cloudPollers.delete(taskRunId);
      pollTicks.delete(taskRunId);
      logger.debug("Stopped cloud S3 polling", { taskRunId });
    }
  },

  _resumeCloudRun: async (
    taskId: string,
    previousRunId: string,
    prompt: string,
  ) => {
    // Fetch the latest task to pick up the branch the previous run was using —
    // otherwise the backend would create a new branch and we'd lose working
    // tree context.
    const freshTask = await getTask(taskId);
    const previousBranch = freshTask.latest_run?.branch ?? null;

    const updatedTask = await runTaskInCloud(taskId, {
      branch: previousBranch,
      resumeFromRunId: previousRunId,
      pendingUserMessage: prompt,
    });

    const newRun = updatedTask.latest_run;
    if (!newRun?.id || !newRun.log_url) {
      throw new Error("Resume run was created but has no id or log_url");
    }

    // Stop polling the dead run and swap the session over to the new run id.
    // Read the CURRENT session state to preserve the local echo that was
    // just added in sendPrompt (the captured `session` variable in the
    // caller is stale).
    get()._stopCloudPolling(previousRunId);

    set((state) => {
      const previousSession = state.sessions[previousRunId];
      if (!previousSession) return state;
      const { [previousRunId]: _old, ...rest } = state.sessions;
      return {
        watchMissionTasks: {
          ...state.watchMissionTasks,
          [taskId]: updatedTask,
        },
        sessions: {
          ...rest,
          [newRun.id]: {
            ...previousSession,
            taskRunId: newRun.id,
            logUrl: newRun.log_url,
            status: "connected",
            isPromptPending: true,
            processedLineCount: 0,
            processedHashes: new Set<string>(),
            awaitingPing: true,
            awaitingAgentOutput: true,
          },
        },
      };
    });
    scheduleWatchMissionPublish({ urgent: true });

    get()._startCloudPolling(newRun.id, newRun.log_url);
    logger.debug("Swapped to resume run", {
      taskId,
      previousRunId,
      newRunId: newRun.id,
    });
  },
}));

// When the app returns from background, iOS resumes JS execution but
// in-flight fetches may have been killed. Clear the pollInFlight guards
// and restart polling for all active sessions to catch up immediately.
AppState.addEventListener("change", (nextState) => {
  if (nextState === "active") {
    pollInFlight.clear();
    pollInFlightSince.clear();
    pollTicks.clear();
    for (const [taskRunId, interval] of cloudPollers) {
      clearInterval(interval);
      cloudPollers.delete(taskRunId);
    }
    const sessions = useTaskSessionStore.getState().sessions;
    for (const session of Object.values(sessions)) {
      if (session.status === "connected" && !session.terminalStatus) {
        useTaskSessionStore
          .getState()
          ._startCloudPolling(session.taskRunId, session.logUrl);
      }
    }
    ensureWatchCommandSubscription();
    scheduleWatchMissionPublish();
  }
});
