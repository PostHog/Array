import { combineCloudTaskQueuedMessages } from "@posthog/core/sessions/cloudTaskQueue";
import {
  type CloudTaskSessionNotificationKind,
  CloudTaskSessionService,
  type CloudTaskSessionTask,
} from "@posthog/core/sessions/cloudTaskSessionService";
import { serializeCloudPrompt, type Task } from "@posthog/shared";
import * as Haptics from "expo-haptics";
import { AppState } from "react-native";
import { presentLocalNotification } from "@/features/notifications/lib/notifications";
import { usePreferencesStore } from "@/features/preferences/stores/preferencesStore";
import { logger } from "@/lib/logger";
import { getPostHogApiClient } from "@/lib/posthogApiClient";
import {
  CloudCommandError,
  cancelRun,
  runTaskInCloud,
  sendCloudCommand,
} from "../api";
import { buildCloudPromptBlocks } from "../composer/attachments/buildCloudPrompt";
import type { PendingAttachment } from "../composer/attachments/types";
import { watchCloudTask } from "../lib/cloudTaskStream";
import { taskMessageQueue } from "../lib/taskMessageQueue";
import { useAttachmentEchoStore } from "../stores/attachmentEchoStore";
import {
  taskSessionStatePort,
  useTaskSessionStore,
} from "../stores/taskSessionStore";
import { useTaskStore } from "../stores/taskStore";
import type { SessionNotificationAttachment } from "../types";
import { playbackRateForTaskDuration } from "../utils/playbackRate";
import { playCompletionSound } from "../utils/sounds";

const log = logger.scope("task-session-service");
const NOTIFICATION_DEDUP_WINDOW_MS = 30_000;
const lastNotificationAt = new Map<string, number>();

function toSessionTask(task: Task): CloudTaskSessionTask {
  const run = task.latest_run;
  const permissionMode = run?.state?.initial_permission_mode;
  return {
    id: task.id,
    title: task.title,
    latestRun: run
      ? {
          id: run.id,
          branch: run.branch,
          reasoningEffort: run.reasoning_effort,
          initialPermissionMode:
            typeof permissionMode === "string" ? permissionMode : undefined,
        }
      : undefined,
  };
}

function completionPlaybackRate(promptStartedAt?: number): number {
  if (
    !usePreferencesStore.getState().scaleSoundWithTaskLength ||
    promptStartedAt == null
  ) {
    return 1;
  }
  return playbackRateForTaskDuration(Date.now() - promptStartedAt);
}

function presentTaskNotification(args: {
  taskId: string;
  taskRunId: string;
  kind: CloudTaskSessionNotificationKind;
}): void {
  if (!usePreferencesStore.getState().pushNotificationsEnabled) return;
  const state = useTaskSessionStore.getState();
  const session = state.sessions[args.taskRunId];
  if (!session || state.focusedTaskId === args.taskId) return;

  const now = Date.now();
  const previous = lastNotificationAt.get(args.taskId);
  if (previous && now - previous < NOTIFICATION_DEDUP_WINDOW_MS) return;
  lastNotificationAt.set(args.taskId, now);

  const title = session.taskTitle ?? "PostHog Code";
  const body =
    args.kind === "awaiting_user_input"
      ? `"${title}" needs your input`
      : args.kind === "task_failed"
        ? `"${title}" failed`
        : `"${title}" finished`;

  void presentLocalNotification({
    title: "PostHog Code",
    body,
    data: { taskId: args.taskId, taskRunId: args.taskRunId },
  });
}

function reinjectAttachmentEchoes(
  taskRunId: string,
  events: Parameters<
    NonNullable<
      ConstructorParameters<
        typeof CloudTaskSessionService
      >[0]["prompts"]["reinjectSnapshotAttachments"]
    >
  >[1],
): void {
  const echoes = useAttachmentEchoStore.getState().getEchoes(taskRunId);
  let echoIndex = 0;
  for (const event of events) {
    if (echoIndex >= echoes.length) return;
    if (event.type !== "session_update") {
      continue;
    }
    const update = event.notification.update;
    if (update?.sessionUpdate !== "user_message_chunk") continue;
    if (update.attachments?.length) {
      echoIndex += 1;
      continue;
    }
    const echo = echoes[echoIndex];
    echoIndex += 1;
    if (echo.text === (update.content?.text ?? "")) {
      update.attachments = echo.attachments;
    }
  }
}

export const taskSessionService =
  new CloudTaskSessionService<PendingAttachment>({
    state: taskSessionStatePort,
    api: {
      getTask: async (taskId) =>
        toSessionTask(await getPostHogApiClient().getTask(taskId)),
      runTask: async (taskId, options) => {
        if (!options) return toSessionTask(await runTaskInCloud(taskId));
        return toSessionTask(
          await runTaskInCloud(taskId, {
            branch: options.branch,
            runtimeAdapter: "claude",
            reasoningEffort: options.reasoningEffort,
            initialPermissionMode: options.initialPermissionMode,
            rtkEnabled: options.rtkEnabled,
            resumeFromRunId: options.resumeFromRunId,
            pendingUserMessage: options.pendingUserMessage,
          }),
        );
      },
      sendCommand: async (taskId, runId, command, payload) => {
        await sendCloudCommand(taskId, runId, command, payload);
      },
      cancelRun: async (taskId, runId) => {
        await cancelRun(taskId, runId);
      },
      classifyCommandError: (error) => {
        if (error instanceof CloudCommandError) {
          if (error.isSandboxInactive()) return { kind: "sandbox_inactive" };
          if ([502, 503, 504].includes(error.status))
            return { kind: "transient" };
        }
        return { kind: "other" };
      },
    },
    watchers: {
      create: (args) => watchCloudTask({ ...args }),
    },
    queue: {
      get: (taskId) => taskMessageQueue.getQueue(taskId),
      drain: (taskId) => taskMessageQueue.drain(taskId, { stopAtEdited: true }),
      prepend: (taskId, messages) => taskMessageQueue.prepend(taskId, messages),
      remove: (taskId, messageId) => taskMessageQueue.remove(taskId, messageId),
      combine: combineCloudTaskQueuedMessages,
    },
    prompts: {
      prepare: async (prompt, attachments) => {
        const eventAttachments: SessionNotificationAttachment[] =
          attachments.map(({ kind, uri, fileName, mimeType }) => ({
            kind,
            uri,
            fileName,
            mimeType,
          }));
        return {
          wirePayload:
            attachments.length > 0
              ? serializeCloudPrompt(
                  await buildCloudPromptBlocks(prompt, attachments),
                )
              : prompt,
          eventAttachments,
        };
      },
      reinjectSnapshotAttachments: reinjectAttachmentEchoes,
      recordAttachmentEcho: (taskRunId, prompt, attachments) =>
        useAttachmentEchoStore
          .getState()
          .recordEcho(taskRunId, prompt, attachments),
    },
    time: {
      now: Date.now,
      defer: (callback) => setTimeout(callback, 0),
    },
    logger: log,
    effects: {
      onCompletion: ({ promptStartedAt }) => {
        if (!usePreferencesStore.getState().pingsEnabled) return;
        void playCompletionSound(
          undefined,
          undefined,
          completionPlaybackRate(promptStartedAt),
        );
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
      },
      onNotification: presentTaskNotification,
    },
    preferences: {
      getComposerConfig: (taskId) =>
        useTaskStore.getState().composerConfigByTaskId[taskId],
      isRtkEnabled: () => usePreferencesStore.getState().rtkEnabledCloud,
    },
  });

export function connectToTask(task: Task): Promise<void> {
  return taskSessionService.connect(toSessionTask(task));
}

export const taskSessionActions = {
  connectToTask,
  disconnectFromTask: (taskId: string) => taskSessionService.disconnect(taskId),
  sendPrompt: taskSessionService.sendPrompt.bind(taskSessionService),
  sendPermissionResponse:
    taskSessionService.sendPermissionResponse.bind(taskSessionService),
  cancelPrompt: taskSessionService.cancelPrompt.bind(taskSessionService),
  stopRun: taskSessionService.stopRun.bind(taskSessionService),
  sendInterrupting:
    taskSessionService.sendInterrupting.bind(taskSessionService),
  flushQueuedMessages:
    taskSessionService.flushQueuedMessages.bind(taskSessionService),
  flushQueuedMessagesIfIdle:
    taskSessionService.flushQueuedMessagesIfIdle.bind(taskSessionService),
  steerQueuedMessage:
    taskSessionService.steerQueuedMessage.bind(taskSessionService),
  setConfigOption: taskSessionService.setConfigOption.bind(taskSessionService),
};

AppState.addEventListener("change", (nextState) => {
  if (nextState === "active") taskSessionService.reconnectWatchers();
});
