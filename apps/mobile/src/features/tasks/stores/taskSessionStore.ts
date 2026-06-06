import * as Haptics from "expo-haptics";
import { AppState } from "react-native";
import { create } from "zustand";
import { presentLocalNotification } from "@/features/notifications/lib/notifications";
import { usePreferencesStore } from "@/features/preferences/stores/preferencesStore";
import { logger } from "@/lib/logger";
import {
  CloudCommandError,
  getTask,
  runTaskInCloud,
  sendCloudCommand,
} from "../api";
import { buildCloudPromptBlocks } from "../composer/attachments/buildCloudPrompt";
import { serializeCloudPrompt } from "../composer/attachments/cloudPrompt";
import type { PendingAttachment } from "../composer/attachments/types";
import {
  type WatchCloudTaskHandle,
  watchCloudTask,
} from "../lib/cloudTaskStream";
import {
  type CloudPendingPermissionRequest,
  type CloudTaskUpdatePayload,
  isTerminalStatus,
  type SessionEvent,
  type SessionNotification,
  type SessionNotificationAttachment,
  type StoredLogEntry,
  type Task,
} from "../types";
import { convertStoredEntriesToEvents } from "../utils/parseSessionLogs";
import { playMeepSound } from "../utils/sounds";
import { useAttachmentEchoStore } from "./attachmentEchoStore";

const log = logger.scope("task-session-store");

// Match historical `user_message_chunk` events (text-only, as the cloud
// stores them) against locally-cached attachment echoes by position+text.
// Echoes are written in send-order; we walk user messages in receive-order
// and zip them up. Drift (text mismatch at the same index) is treated as a
// no-op rather than a misattribution.
function reinjectAttachmentEchoes(
  taskRunId: string,
  events: SessionEvent[],
): void {
  const echoes = useAttachmentEchoStore.getState().getEchoes(taskRunId);
  if (echoes.length === 0) return;

  let echoIdx = 0;
  for (const event of events) {
    if (echoIdx >= echoes.length) return;
    if (event.type !== "session_update") continue;
    const update = event.notification?.update;
    if (update?.sessionUpdate !== "user_message_chunk") continue;
    if (update.attachments && update.attachments.length > 0) {
      echoIdx++;
      continue;
    }
    const echo = echoes[echoIdx];
    echoIdx++;
    if (echo.text === (update.content?.text ?? "")) {
      update.attachments = echo.attachments;
    }
  }
}

type LocalNotificationKind =
  | "turn_complete"
  | "awaiting_user_input"
  | "task_failed";

// Per-task cooldown so a noisy stream of terminal/awaiting events doesn't
// fire a burst of identical banners. Keyed by taskId, value is the epoch ms
// of the most recent notification for that task.
const NOTIFICATION_DEDUP_WINDOW_MS = 30_000;
const lastNotificationAt = new Map<string, number>();

// TODO: server-side device presence. Today we can only suppress notifications
// when *this* device is foregrounded on the task (`focusedTaskId` check
// below). That leaves the cross-device case uncovered — e.g. desktop is open
// on the same task, server fans the push to every registered token, mobile
// still rings. Once the `/api/projects/{team_id}/tasks/{task_id}/presence/`
// beacon endpoint lands in posthog/posthog, add:
//   1. A stable per-install device_id (probably derive from pushTokenStore).
//   2. POST presence every ~30s while a task screen is mounted AND AppState
//      is "active".
//   3. DELETE presence on screen blur or AppState → "background"/"inactive".
// The server will then drop pushes to devices with non-expired presence for
// the target task, so this client-side maybePresentLocalNotification stays
// as-is (it's only the OS fanout path we're improving).

function maybePresentLocalNotification(args: {
  taskRunId: string;
  kind: LocalNotificationKind;
}): void {
  if (!usePreferencesStore.getState().pushNotificationsEnabled) return;

  const storeState = useTaskSessionStore.getState();
  const session = storeState.sessions[args.taskRunId];
  if (!session) return;

  // Skip when the user is actively viewing this task — the UI already
  // surfaces what changed; an OS banner would be redundant noise.
  if (storeState.focusedTaskId === session.taskId) return;

  // Dedup: skip if we just notified about this task.
  const now = Date.now();
  const previous = lastNotificationAt.get(session.taskId);
  if (previous && now - previous < NOTIFICATION_DEDUP_WINDOW_MS) return;
  lastNotificationAt.set(session.taskId, now);

  const title = session.taskTitle ?? "PostHog Code";
  let body: string;
  switch (args.kind) {
    case "awaiting_user_input":
      body = `"${title}" needs your input`;
      break;
    case "task_failed":
      body = `"${title}" failed`;
      break;
    default:
      body = `"${title}" finished`;
      break;
  }

  presentLocalNotification({
    title: "PostHog Code",
    body,
    data: { taskId: session.taskId, taskRunId: session.taskRunId },
  }).catch(() => {});
}

// Session-update kinds that count as "the agent produced visible output" —
// once we've seen one of these the connecting/thinking indicator should clear.
const VISIBLE_AGENT_SESSION_UPDATES = new Set([
  "agent_message_chunk",
  "agent_message",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
]);

// Notification methods that mark the end of an agent turn — clearing
// isPromptPending so the composer unblocks.
const TURN_END_METHODS = new Set([
  "_posthog/turn_complete",
  "_posthog/task_complete",
  "_posthog/error",
  "_posthog/awaiting_user_input",
]);

interface BatchAnalysis {
  hasTurnEnd: boolean;
  hasAwaitingUserInput: boolean;
  hasTurnCompleted: boolean;
  hasTurnFailed: boolean;
  hasVisibleAgentOutput: boolean;
  externalUserMessageCount: number;
  agentMessageFinalized: boolean;
}

function analyzeEntries(
  entries: StoredLogEntry[],
  localUserEchoes: Set<string>,
): BatchAnalysis {
  let hasTurnEnd = false;
  let hasAwaitingUserInput = false;
  let hasTurnCompleted = false;
  let hasTurnFailed = false;
  let hasVisibleAgentOutput = false;
  let externalUserMessageCount = 0;
  let agentMessageFinalized = false;

  for (const entry of entries) {
    const method = entry.notification?.method;
    if (method && TURN_END_METHODS.has(method)) {
      hasTurnEnd = true;
      if (method === "_posthog/awaiting_user_input") {
        hasAwaitingUserInput = true;
      }
      if (
        method === "_posthog/turn_complete" ||
        method === "_posthog/task_complete"
      ) {
        hasTurnCompleted = true;
      }
      if (method === "_posthog/error") {
        hasTurnFailed = true;
      }
    }

    if (
      entry.type === "notification" &&
      method === "session/update" &&
      entry.notification?.params
    ) {
      const params = entry.notification.params as SessionNotification;
      const sessionUpdate = params.update?.sessionUpdate;
      if (sessionUpdate && VISIBLE_AGENT_SESSION_UPDATES.has(sessionUpdate)) {
        hasVisibleAgentOutput = true;
      }
      if (sessionUpdate === "agent_message") {
        agentMessageFinalized = true;
      }
      if (sessionUpdate === "user_message_chunk") {
        const text = params.update?.content?.text;
        if (text && !localUserEchoes.has(text)) {
          externalUserMessageCount += 1;
        }
      }
    }
  }

  return {
    hasTurnEnd,
    hasAwaitingUserInput,
    hasTurnCompleted,
    hasTurnFailed,
    hasVisibleAgentOutput,
    externalUserMessageCount,
    agentMessageFinalized,
  };
}

// Strip user_message_chunk entries whose text matches a pending local echo
// (one match per echo). The echo set is mutated so each echo only cancels
// one canonical copy.
function dedupAgainstLocalEchoes(
  entries: StoredLogEntry[],
  localUserEchoes: Set<string>,
): StoredLogEntry[] {
  if (localUserEchoes.size === 0) return entries;
  const result: StoredLogEntry[] = [];
  for (const entry of entries) {
    if (
      entry.type === "notification" &&
      entry.notification?.method === "session/update"
    ) {
      const params = entry.notification?.params as SessionNotification;
      const sessionUpdate = params?.update?.sessionUpdate;
      if (sessionUpdate === "user_message_chunk") {
        const text = params?.update?.content?.text;
        if (text && localUserEchoes.has(text)) {
          localUserEchoes.delete(text);
          continue;
        }
      }
    }
    result.push(entry);
  }
  return result;
}

export interface TaskSession {
  taskRunId: string;
  taskId: string;
  taskTitle?: string;
  events: SessionEvent[];
  status: "connecting" | "connected" | "disconnected" | "error";
  isPromptPending: boolean;
  // Content of user prompts echoed locally (before the agent writes them to
  // the log). Used to dedup the canonical copy against the echo.
  localUserEchoes?: Set<string>;
  // Terminal backend status for this run, populated by status updates so the
  // UI can surface "Run failed" / "Run completed".
  terminalStatus?: "failed" | "completed";
  lastError?: string | null;
  // True when the user initiated work (new task, sendPrompt, resume) and
  // we should play a sound when control returns. False when reconnecting
  // to an already-running task to avoid spurious pings.
  awaitingPing?: boolean;
  // True after a user prompt is sent, cleared when the first piece of
  // agent output (tool call, message, etc.) arrives.
  awaitingAgentOutput?: boolean;
  // Timestamp of the last new event received. Used to detect stale local
  // sessions (desktop stopped syncing).
  lastEventAt?: number;
  // Maps toolCallId → cloud requestId for routing permission responses. The
  // cloud's permission_response command requires the requestId it generated
  // when emitting the original permission_request SSE event; we capture it
  // here so the response can be routed back to the awaiting tool call.
  cloudPermissionRequestIds?: Record<string, string>;
  pendingPermissions?: Record<string, CloudPendingPermissionRequest>;
}

interface TaskSessionStore {
  sessions: Record<string, TaskSession>;
  focusedTaskId: string | null;

  setFocusedTaskId: (taskId: string | null) => void;

  connectToTask: (task: Task) => Promise<void>;
  disconnectFromTask: (taskId: string) => void;
  sendPrompt: (
    taskId: string,
    prompt: string,
    attachments?: PendingAttachment[],
  ) => Promise<void>;
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
  setConfigOption: (
    taskId: string,
    configId: string,
    value: string,
  ) => Promise<void>;
  getSessionForTask: (taskId: string) => TaskSession | undefined;

  _handleCloudUpdate: (
    taskRunId: string,
    update: CloudTaskUpdatePayload,
  ) => void;
  _startWatcher: (taskRunId: string, taskId: string) => void;
  _stopWatcher: (taskRunId: string) => void;
  _resumeCloudRun: (
    taskId: string,
    previousRunId: string,
    prompt: string,
  ) => Promise<void>;
}

const watchHandles = new Map<string, WatchCloudTaskHandle>();
const connectAttempts = new Set<string>();

function mapTerminalStatus(
  status: string | undefined | null,
): "completed" | "failed" | undefined {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "cancelled") return "failed";
  return undefined;
}

export const useTaskSessionStore = create<TaskSessionStore>((set, get) => ({
  sessions: {},
  focusedTaskId: null,

  setFocusedTaskId: (taskId) => set({ focusedTaskId: taskId }),

  connectToTask: async (task: Task) => {
    const taskId = task.id;
    const latestRunId = task.latest_run?.id;

    if (connectAttempts.has(taskId)) {
      log.debug("Connection already in progress", { taskId });
      return;
    }

    const existing = get().getSessionForTask(taskId);
    if (existing && existing.status === "connected") {
      log.debug("Already connected to task", { taskId });
      return;
    }

    connectAttempts.add(taskId);

    try {
      let runId = latestRunId;
      let awaitingPing = false;

      if (!runId) {
        log.debug("Task has no run yet, starting cloud run", { taskId });
        const updatedTask = await runTaskInCloud(taskId);
        runId = updatedTask.latest_run?.id;
        if (!runId) {
          log.error("Failed to start cloud run");
          return;
        }
        awaitingPing = true;
      }

      set((state) => ({
        sessions: {
          ...state.sessions,
          [runId]: {
            taskRunId: runId,
            taskId,
            taskTitle: task.title,
            events: [],
            status: "connecting",
            // Assume the run is working until the bootstrap snapshot tells
            // us otherwise — the SSE watcher will refine these fields.
            isPromptPending: true,
            awaitingPing,
            awaitingAgentOutput: true,
          },
        },
      }));

      get()._startWatcher(runId, taskId);
      log.debug("Started SSE watcher", { taskId, runId });
    } catch (error) {
      log.error("Failed to connect to task", error);
    } finally {
      connectAttempts.delete(taskId);
    }
  },

  disconnectFromTask: (taskId: string) => {
    const session = get().getSessionForTask(taskId);
    if (!session) return;

    get()._stopWatcher(session.taskRunId);

    set((state) => {
      const { [session.taskRunId]: _, ...rest } = state.sessions;
      return { sessions: rest };
    });
    log.debug("Disconnected from task", { taskId });
  },

  sendPrompt: async (
    taskId: string,
    prompt: string,
    attachments: PendingAttachment[] = [],
  ) => {
    const session = get().getSessionForTask(taskId);
    if (!session) {
      throw new Error("No active session for task");
    }

    // The local echo always shows the plain prompt text in the chat. When
    // attachments are present we send a structured cloud-prompt blob on the
    // wire (`__twig_cloud_prompt_v1__:…`) so the agent receives the image
    // and resource blocks alongside the text.
    const wirePayload =
      attachments.length > 0
        ? serializeCloudPrompt(
            await buildCloudPromptBlocks(prompt, attachments),
          )
        : prompt;

    const ts = Date.now();
    const echoAttachments: SessionNotificationAttachment[] =
      attachments.length > 0
        ? attachments.map((a) => ({
            kind: a.kind,
            uri: a.uri,
            fileName: a.fileName,
            mimeType: a.mimeType,
          }))
        : [];
    const userEvent: SessionEvent = {
      type: "session_update",
      ts,
      notification: {
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: prompt },
          attachments: echoAttachments.length > 0 ? echoAttachments : undefined,
        },
      },
    };
    if (echoAttachments.length > 0) {
      useAttachmentEchoStore
        .getState()
        .recordEcho(session.taskRunId, prompt, echoAttachments);
    }

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

    try {
      await sendCloudCommand(taskId, session.taskRunId, "user_message", {
        content: wirePayload,
      });
      log.debug("Sent cloud command user_message", {
        taskId,
        runId: session.taskRunId,
      });
    } catch (err) {
      if (
        err instanceof CloudCommandError &&
        (err.status === 504 || err.status === 502 || err.status === 503)
      ) {
        log.warn("Transient server error sending prompt, rolling back", {
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
        throw err;
      }

      let rollbackError: unknown = err;
      if (err instanceof CloudCommandError && err.isSandboxInactive()) {
        log.info("Sandbox inactive, creating resume run", {
          taskId,
          previousRunId: session.taskRunId,
        });
        try {
          await get()._resumeCloudRun(taskId, session.taskRunId, wirePayload);
          return;
        } catch (resumeErr) {
          log.error("Failed to resume cloud run", resumeErr);
          rollbackError = resumeErr;
        }
      }

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
      throw rollbackError;
    }
  },

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

    // The cloud command requires the requestId it generated when emitting
    // the permission_request SSE event — toolCallId alone is not sufficient
    // for routing the response back to the awaiting tool call.
    const cloudRequestId =
      session.cloudPermissionRequestIds?.[args.toolCallId] ??
      session.pendingPermissions?.[args.toolCallId]?.requestId;

    set((state) => {
      const current = state.sessions[session.taskRunId];
      const currentPermission = current?.pendingPermissions?.[args.toolCallId];
      if (!current || !currentPermission) return state;
      return {
        sessions: {
          ...state.sessions,
          [session.taskRunId]: {
            ...current,
            pendingPermissions: {
              ...(current.pendingPermissions ?? {}),
              [args.toolCallId]: {
                ...currentPermission,
                response: {
                  optionId: args.optionId,
                  displayText: args.displayText,
                  ...(args.answers ? { answers: args.answers } : {}),
                  ...(args.customInput
                    ? { customInput: args.customInput }
                    : {}),
                },
              },
            },
          },
        },
      };
    });

    try {
      await sendCloudCommand(taskId, session.taskRunId, "permission_response", {
        ...(cloudRequestId ? { requestId: cloudRequestId } : {}),
        toolCallId: args.toolCallId,
        optionId: args.optionId,
        ...(args.answers ? { answers: args.answers } : {}),
        ...(args.customInput ? { customInput: args.customInput } : {}),
      });
      log.debug("Sent permission_response", {
        taskId,
        runId: session.taskRunId,
        toolCallId: args.toolCallId,
        requestId: cloudRequestId,
      });

      // One-shot: drop the mapping once we've responded so we don't reuse
      // it accidentally.
      if (cloudRequestId) {
        set((state) => {
          const current = state.sessions[session.taskRunId];
          if (!current?.cloudPermissionRequestIds) return state;
          const next = { ...current.cloudPermissionRequestIds };
          delete next[args.toolCallId];
          return {
            sessions: {
              ...state.sessions,
              [session.taskRunId]: {
                ...current,
                cloudPermissionRequestIds: next,
              },
            },
          };
        });
      }
    } catch (err) {
      log.error("Failed to send permission_response", err);
      set((state) => {
        const current = state.sessions[session.taskRunId];
        if (!current) return state;
        const nextLocalEchoes = new Set(current.localUserEchoes ?? []);
        nextLocalEchoes.delete(args.displayText);
        const currentPermission = current.pendingPermissions?.[args.toolCallId];
        return {
          sessions: {
            ...state.sessions,
            [session.taskRunId]: {
              ...current,
              events: current.events.filter((e) => e !== userEvent),
              localUserEchoes: nextLocalEchoes,
              pendingPermissions: currentPermission
                ? {
                    ...(current.pendingPermissions ?? {}),
                    [args.toolCallId]: {
                      ...currentPermission,
                      response: undefined,
                    },
                  }
                : current.pendingPermissions,
              isPromptPending: false,
            },
          },
        };
      });
      throw err;
    }
  },

  setConfigOption: async (taskId, configId, value) => {
    const session = get().getSessionForTask(taskId);
    if (!session || session.terminalStatus) return;

    try {
      await sendCloudCommand(taskId, session.taskRunId, "set_config_option", {
        configId,
        value,
      });
      log.debug("Sent set_config_option", {
        taskId,
        runId: session.taskRunId,
        configId,
        value,
      });
    } catch (err) {
      log.warn("Failed to send set_config_option", {
        taskId,
        configId,
        error: err,
      });
      throw err;
    }
  },

  cancelPrompt: async (taskId: string) => {
    const session = get().getSessionForTask(taskId);
    if (!session) return false;

    try {
      await sendCloudCommand(taskId, session.taskRunId, "cancel");
      log.debug("Sent cancel command", {
        taskId,
        runId: session.taskRunId,
      });

      set((state) => ({
        sessions: {
          ...state.sessions,
          [session.taskRunId]: {
            ...state.sessions[session.taskRunId],
            isPromptPending: false,
            awaitingPing: false,
            awaitingAgentOutput: false,
          },
        },
      }));
      return true;
    } catch (error) {
      log.error("Failed to send cancel request", error);
      return false;
    }
  },

  getSessionForTask: (taskId: string) => {
    return Object.values(get().sessions).find((s) => s.taskId === taskId);
  },

  _startWatcher: (taskRunId: string, taskId: string) => {
    if (watchHandles.has(taskRunId)) return;

    const handle = watchCloudTask({
      taskId,
      runId: taskRunId,
      onUpdate: (update) => get()._handleCloudUpdate(taskRunId, update),
    });
    watchHandles.set(taskRunId, handle);
  },

  _stopWatcher: (taskRunId: string) => {
    const handle = watchHandles.get(taskRunId);
    if (handle) {
      handle.stop();
      watchHandles.delete(taskRunId);
      log.debug("Stopped SSE watcher", { taskRunId });
    }
  },

  _handleCloudUpdate: (taskRunId: string, update: CloudTaskUpdatePayload) => {
    if (update.kind === "error") {
      set((state) => {
        const current = state.sessions[taskRunId];
        if (!current) return state;
        return {
          sessions: {
            ...state.sessions,
            [taskRunId]: {
              ...current,
              status: "error",
              isPromptPending: false,
              lastError: update.errorMessage,
            },
          },
        };
      });
      return;
    }

    if (update.kind === "permission_request") {
      // The tool_call UI itself comes from the `session/update` log stream;
      // this SSE-only payload exists so we can capture the cloud-side
      // requestId required to route a permission_response back to the
      // correct pending tool call.
      const toolCallId = update.toolCall?.toolCallId;
      if (toolCallId && update.requestId) {
        set((state) => {
          const current = state.sessions[taskRunId];
          if (!current) return state;
          return {
            sessions: {
              ...state.sessions,
              [taskRunId]: {
                ...current,
                cloudPermissionRequestIds: {
                  ...(current.cloudPermissionRequestIds ?? {}),
                  [toolCallId]: update.requestId,
                },
                pendingPermissions: {
                  ...(current.pendingPermissions ?? {}),
                  [toolCallId]: {
                    requestId: update.requestId,
                    toolCall: update.toolCall,
                    options: update.options,
                  },
                },
              },
            },
          };
        });
      }
      return;
    }

    if (update.kind === "snapshot" || update.kind === "logs") {
      const isSnapshot = update.kind === "snapshot";

      // Snapshot replaces all events; drop pending echoes since the snapshot
      // already includes the canonical copies.
      const existing = get().sessions[taskRunId];
      const echoSet = isSnapshot
        ? new Set<string>()
        : new Set(existing?.localUserEchoes ?? []);

      const dedupedEntries = isSnapshot
        ? update.newEntries
        : dedupAgainstLocalEchoes(update.newEntries, echoSet);

      const events = convertStoredEntriesToEvents(dedupedEntries);
      // Snapshots are S3-backed and lose attachment metadata; reattach from
      // the local echo store so historical user messages keep their images.
      if (isSnapshot) {
        reinjectAttachmentEchoes(taskRunId, events);
      }

      const analysis = analyzeEntries(
        dedupedEntries,
        isSnapshot ? new Set() : echoSet,
      );

      const wasAwaitingPing = existing?.awaitingPing ?? false;

      set((state) => {
        const current = state.sessions[taskRunId];
        if (!current) return state;

        let nextIsPromptPending = current.isPromptPending;
        if (analysis.externalUserMessageCount > 0) nextIsPromptPending = true;
        if (analysis.hasTurnEnd || analysis.agentMessageFinalized) {
          nextIsPromptPending = false;
        }

        // Snapshots replay historical content — we don't mutate awaitingPing
        // based on history, otherwise turn-end markers inside an existing
        // run's snapshot would clear the user's pending ping before the
        // status block has a chance to fire its (more specific, e.g.
        // "task_failed") notification. The status block below is the
        // canonical owner of awaitingPing for terminal snapshots.
        //
        // awaitingPing is only ever set by this-device actions (sendPrompt,
        // sendPermissionResponse, fresh runs, resumes). External user
        // messages — i.e. another device chatting in the same task — must
        // NOT arm it; otherwise mobile would fire notifications for desktop
        // activity. Clearing on turn-end / finalized agent message stays.
        let nextAwaitingPing = current.awaitingPing;
        if (
          !isSnapshot &&
          (analysis.hasTurnEnd || analysis.agentMessageFinalized)
        ) {
          nextAwaitingPing = false;
        }

        const nextAwaitingAgentOutput =
          current.awaitingAgentOutput && !analysis.hasVisibleAgentOutput;

        const nextEvents = isSnapshot
          ? events
          : events.length > 0
            ? [...current.events, ...events]
            : current.events;

        return {
          sessions: {
            ...state.sessions,
            [taskRunId]: {
              ...current,
              events: nextEvents,
              status: "connected",
              isPromptPending: nextIsPromptPending,
              awaitingPing: nextAwaitingPing,
              awaitingAgentOutput: nextAwaitingAgentOutput,
              localUserEchoes: echoSet.size > 0 ? echoSet : undefined,
              lastEventAt: events.length > 0 ? Date.now() : current.lastEventAt,
            },
          },
        };
      });

      // Live `logs` deltas fire pings for three turn-boundary cases:
      //   * agent is blocked on the user (_posthog/awaiting_user_input)
      //   * agent finished its turn (_posthog/turn_complete / task_complete)
      //   * agent errored out the turn (_posthog/error)
      // The terminal-status block below can't be relied on for these: the
      // turn-end log entry arrives first and clears `awaitingPing`, so by
      // the time status terminal fires its `preState.awaitingPing` is
      // already false. Status-only termination (sandbox killed without a
      // turn-end log) still falls through to the status block. Snapshots
      // are historical replay — never ping for those.
      const shouldPingForAwaitingInput =
        !isSnapshot && wasAwaitingPing && analysis.hasAwaitingUserInput;
      const shouldPingForTurnComplete =
        !isSnapshot &&
        wasAwaitingPing &&
        analysis.hasTurnCompleted &&
        !analysis.hasAwaitingUserInput;
      const shouldPingForTurnFailed =
        !isSnapshot &&
        wasAwaitingPing &&
        analysis.hasTurnFailed &&
        !analysis.hasAwaitingUserInput &&
        !analysis.hasTurnCompleted;
      const shouldPingNow =
        shouldPingForAwaitingInput ||
        shouldPingForTurnComplete ||
        shouldPingForTurnFailed;
      if (shouldPingNow && usePreferencesStore.getState().pingsEnabled) {
        playMeepSound().catch(() => {});
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      if (shouldPingForAwaitingInput) {
        maybePresentLocalNotification({
          taskRunId,
          kind: "awaiting_user_input",
        });
      } else if (shouldPingForTurnComplete) {
        maybePresentLocalNotification({
          taskRunId,
          kind: "turn_complete",
        });
      } else if (shouldPingForTurnFailed) {
        maybePresentLocalNotification({
          taskRunId,
          kind: "task_failed",
        });
      }
    }

    if (update.kind === "status" || update.kind === "snapshot") {
      if (isTerminalStatus(update.status)) {
        const preState = get().sessions[taskRunId];
        const shouldPing = preState?.awaitingPing ?? false;
        const terminal = mapTerminalStatus(update.status);
        set((state) => {
          const current = state.sessions[taskRunId];
          if (!current) return state;
          return {
            sessions: {
              ...state.sessions,
              [taskRunId]: {
                ...current,
                isPromptPending: false,
                terminalStatus: terminal,
                lastError: update.errorMessage ?? null,
                awaitingPing: false,
              },
            },
          };
        });
        if (shouldPing && usePreferencesStore.getState().pingsEnabled) {
          playMeepSound().catch(() => {});
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        if (shouldPing) {
          maybePresentLocalNotification({
            taskRunId,
            kind: terminal === "failed" ? "task_failed" : "turn_complete",
          });
        }
      }
    }
  },

  _resumeCloudRun: async (
    taskId: string,
    previousRunId: string,
    prompt: string,
  ) => {
    const freshTask = await getTask(taskId);
    const previousBranch = freshTask.latest_run?.branch ?? null;

    const updatedTask = await runTaskInCloud(taskId, {
      branch: previousBranch,
      resumeFromRunId: previousRunId,
      pendingUserMessage: prompt,
    });

    const newRun = updatedTask.latest_run;
    if (!newRun?.id) {
      throw new Error("Resume run was created but has no id");
    }

    get()._stopWatcher(previousRunId);

    set((state) => {
      const previousSession = state.sessions[previousRunId];
      if (!previousSession) return state;
      const { [previousRunId]: _old, ...rest } = state.sessions;
      return {
        sessions: {
          ...rest,
          [newRun.id]: {
            ...previousSession,
            taskRunId: newRun.id,
            status: "connecting",
            isPromptPending: true,
            awaitingPing: true,
            awaitingAgentOutput: true,
          },
        },
      };
    });

    get()._startWatcher(newRun.id, taskId);
    log.debug("Swapped to resume run", {
      taskId,
      previousRunId,
      newRunId: newRun.id,
    });
  },
}));

// When the app returns from background, iOS may have killed the SSE
// connection. Nudge every active watcher to reconnect so the stream resumes
// with Last-Event-ID.
AppState.addEventListener("change", (nextState) => {
  if (nextState !== "active") return;
  for (const handle of watchHandles.values()) {
    handle.reconnectIfDisconnected();
  }
});
