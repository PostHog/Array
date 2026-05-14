import { Text } from "@components/text";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  View,
} from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { getTask, runTaskInCloud } from "@/features/tasks/api";
import { FloatingTaskHeader } from "@/features/tasks/components/FloatingTaskHeader";
import { PrDiffStatsBadge } from "@/features/tasks/components/PrDiffStatsBadge";
import { PrStatusBadge } from "@/features/tasks/components/PrStatusBadge";
import { TaskSessionView } from "@/features/tasks/components/TaskSessionView";
import { buildCloudPromptBlocks } from "@/features/tasks/composer/attachments/buildCloudPrompt";
import { serializeCloudPrompt } from "@/features/tasks/composer/attachments/cloudPrompt";
import type { PendingAttachment } from "@/features/tasks/composer/attachments/types";
import {
  DEFAULT_EXECUTION_MODE,
  DEFAULT_MODEL,
  DEFAULT_REASONING,
  type ExecutionMode,
  modelSupportsReasoning,
  type ReasoningEffort,
} from "@/features/tasks/composer/options";
import { TaskChatComposer } from "@/features/tasks/composer/TaskChatComposer";
import { taskKeys } from "@/features/tasks/hooks/useTasks";
import { useTaskSessionStore } from "@/features/tasks/stores/taskSessionStore";
import { useTaskStore } from "@/features/tasks/stores/taskStore";
import type { Task } from "@/features/tasks/types";
import { getSessionActivityPhase } from "@/features/tasks/utils/sessionActivity";
import { logger } from "@/lib/logger";
import { useThemeColors } from "@/lib/theme";

const log = logger.scope("task-detail");

export default function TaskDetailScreen() {
  const {
    id: taskId,
    fromAutomation,
    automationName,
    prompt: initialPrompt,
  } = useLocalSearchParams<{
    id: string;
    fromAutomation?: string;
    automationName?: string;
    prompt?: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const themeColors = useThemeColors();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const {
    connectToTask,
    disconnectFromTask,
    sendPrompt,
    cancelPrompt,
    sendPermissionResponse,
    setConfigOption,
    getSessionForTask,
    setFocusedTaskId,
    setActiveWatchTask,
  } = useTaskSessionStore();

  useEffect(() => {
    if (!taskId) return;
    setFocusedTaskId(taskId);
    setActiveWatchTask(taskId);
    return () => {
      setFocusedTaskId(null);
      setActiveWatchTask(undefined);
    };
  }, [taskId, setFocusedTaskId, setActiveWatchTask]);

  const session = taskId ? getSessionForTask(taskId) : undefined;

  // Per-task composer pill values. Persisted in taskStore so reopening the
  // task keeps the user's choices; defaults fall back to the same constants
  // the new-task composer uses.
  const composerConfig = useTaskStore((s) =>
    taskId ? s.composerConfigByTaskId[taskId] : undefined,
  );
  const pendingPrompt = useTaskStore((s) =>
    taskId ? s.pendingPromptByTaskId[taskId] : undefined,
  );
  const setComposerConfig = useTaskStore((s) => s.setComposerConfig);
  const setPendingPrompt = useTaskStore((s) => s.setPendingPrompt);
  const consumePendingPrompt = useTaskStore((s) => s.consumePendingPrompt);
  const [initialComposerMessage, setInitialComposerMessage] = useState<
    string | undefined
  >();
  const composerMode: ExecutionMode =
    composerConfig?.mode ?? DEFAULT_EXECUTION_MODE;
  const composerModel = composerConfig?.model ?? DEFAULT_MODEL;
  const composerReasoning: ReasoningEffort =
    composerConfig?.reasoning ?? DEFAULT_REASONING;

  const { height } = useReanimatedKeyboardAnimation();

  // useReanimatedKeyboardAnimation returns negative height values
  // e.g., -300 when keyboard is open, 0 when closed
  const contentPosition = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: height.value }],
    };
  }, []);

  const inputContainerStyle = useAnimatedStyle(() => {
    // contentPosition already translates the whole content up by the keyboard
    // height, so the composer sits at the keyboard top — no extra gap needed
    // when open. Closed state keeps a comfortable bottom inset.
    return {
      marginBottom: height.value < 0 ? 0 : Math.max(insets.bottom, 50),
    };
  }, [insets.bottom]);

  useEffect(() => {
    if (!taskId) return;
    const promptParam = Array.isArray(initialPrompt)
      ? initialPrompt[0]
      : initialPrompt;
    if (promptParam?.trim()) {
      setPendingPrompt(taskId, promptParam.trim());
    }
  }, [taskId, initialPrompt, setPendingPrompt]);

  useEffect(() => {
    if (!taskId || !pendingPrompt) return;
    const prompt = consumePendingPrompt(taskId);
    if (prompt) setInitialComposerMessage(prompt);
  }, [taskId, pendingPrompt, consumePendingPrompt]);

  useEffect(() => {
    if (!taskId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getTask(taskId)
      .then((fetchedTask) => {
        if (cancelled) return;
        setTask(fetchedTask);
        return connectToTask(fetchedTask);
      })
      .catch((err) => {
        if (cancelled) return;
        log.error("Failed to load task", err);
        setError("Failed to load task");
      })
      .finally(() => {
        if (cancelled) return;
        // Brief delay for FlatList to render its initial batch behind
        // the loading overlay before revealing.
        setTimeout(() => setLoading(false), 150);
      });

    return () => {
      cancelled = true;
      disconnectFromTask(taskId);
    };
  }, [taskId, connectToTask, disconnectFromTask]);

  // Auto-reconnect if the session disappears while the screen is active
  // (e.g., cloud sandbox expired and the session was cleaned up).
  // Re-fetches the task to get a fresh S3 presigned URL.
  useEffect(() => {
    if (!taskId || !task || loading) return;
    if (session) return;
    if (retrying) return;

    let cancelled = false;
    getTask(taskId)
      .then((freshTask) => {
        if (cancelled) return;
        setTask(freshTask);
        return connectToTask(freshTask);
      })
      .catch((err) => {
        if (cancelled) return;
        log.error("Failed to reconnect to task", err);
      });

    return () => {
      cancelled = true;
    };
  }, [taskId, task, loading, session, connectToTask, retrying]);

  const updateTaskInCache = useCallback(
    (updated: Task) => {
      // Directly patch the task in all list query caches so the task list
      // reflects the change immediately (e.g., environment: local → cloud).
      queryClient.setQueriesData<Task[]>(
        { queryKey: taskKeys.lists() },
        (old) => old?.map((t) => (t.id === updated.id ? updated : t)),
      );
    },
    [queryClient],
  );

  // Resume a terminal (completed/failed) run with a new user prompt. Mirrors
  // the desktop "send on a finished task continues the conversation" UX —
  // creates a fresh run that resumes from the previous one and queues the
  // message as pending_user_message.
  const handleSendAfterTerminal = useCallback(
    async (text: string, attachments: PendingAttachment[]) => {
      if (!taskId || !task) return;
      try {
        setRetrying(true);
        disconnectFromTask(taskId);

        const pendingUserMessage =
          attachments.length > 0
            ? serializeCloudPrompt(
                await buildCloudPromptBlocks(text, attachments),
              )
            : text;

        const supportsReasoning = modelSupportsReasoning(composerModel);
        const updatedTask = await runTaskInCloud(taskId, {
          resumeFromRunId: task.latest_run?.id,
          pendingUserMessage,
          runtimeAdapter: "claude",
          model: composerModel,
          reasoningEffort: supportsReasoning ? composerReasoning : undefined,
          initialPermissionMode: composerMode,
        });
        setTask(updatedTask);
        await connectToTask(updatedTask);
        updateTaskInCache(updatedTask);
      } catch (err) {
        log.error("Failed to send after terminal", err);
        setRetrying(false);
        Alert.alert(
          "Failed to send",
          "Could not continue this task. Please try again.",
        );
      }
    },
    [
      taskId,
      task,
      disconnectFromTask,
      connectToTask,
      updateTaskInCache,
      composerMode,
      composerModel,
      composerReasoning,
    ],
  );

  const handleSendPrompt = useCallback(
    (text: string, attachments: PendingAttachment[]) => {
      if (!taskId) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (session?.terminalStatus) {
        handleSendAfterTerminal(text, attachments);
        return;
      }

      sendPrompt(taskId, text, attachments).catch((err) => {
        log.error("Failed to send prompt", err);
        Alert.alert(
          "Failed to send",
          "Your message could not be delivered. Please try again.",
        );
      });
    },
    [taskId, sendPrompt, session?.terminalStatus, handleSendAfterTerminal],
  );

  const handleModeChange = useCallback(
    (value: ExecutionMode) => {
      if (!taskId) return;
      setComposerConfig(taskId, { mode: value });
      // Push to the live cloud session so the next turn uses the new mode.
      // Silently ignore failures — value is already persisted locally and
      // will be replayed if the user resumes from a terminal state.
      setConfigOption(taskId, "mode", value).catch(() => {});
    },
    [taskId, setComposerConfig, setConfigOption],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      if (!taskId) return;
      setComposerConfig(taskId, { model: value });
      setConfigOption(taskId, "model", value).catch(() => {});
    },
    [taskId, setComposerConfig, setConfigOption],
  );

  const handleReasoningChange = useCallback(
    (value: ReasoningEffort) => {
      if (!taskId) return;
      setComposerConfig(taskId, { reasoning: value });
      setConfigOption(taskId, "effort", value).catch(() => {});
    },
    [taskId, setComposerConfig, setConfigOption],
  );

  const handleStop = useCallback(() => {
    if (!taskId) return;
    // cancelPrompt returns false on failure — no need to alert,
    // the agent may have already finished or the sandbox expired.
    cancelPrompt(taskId).catch(() => {});
  }, [taskId, cancelPrompt]);

  const handleRetry = useCallback(async () => {
    if (!taskId || !task) return;
    try {
      setRetrying(true);
      disconnectFromTask(taskId);

      const updatedTask = await runTaskInCloud(taskId, {
        resumeFromRunId: task.latest_run?.id,
      });
      setTask(updatedTask);
      await connectToTask(updatedTask);
      updateTaskInCache(updatedTask);
      // Don't clear retrying here — the effect below clears it
      // once the session shows meaningful state (thinking or terminal).
    } catch (err) {
      log.error("Failed to retry task", err);
      setRetrying(false);
      Alert.alert(
        "Retry failed",
        "Could not restart the task. Please try again.",
      );
    }
  }, [taskId, task, disconnectFromTask, connectToTask, updateTaskInCache]);

  // Clear retrying once the agent finishes a turn or the run terminates.
  useEffect(() => {
    if (!retrying || !session) return;
    if (!session.isPromptPending || session.terminalStatus) {
      setRetrying(false);
    }
  }, [retrying, session]);

  const handleSendPermissionResponse = useCallback(
    (args: Parameters<typeof sendPermissionResponse>[1]) => {
      if (!taskId) return;
      sendPermissionResponse(taskId, args).catch((err) => {
        log.error("Failed to send permission response", err);
        Alert.alert(
          "Failed to respond",
          "Your permission response could not be sent. Please try again.",
        );
      });
    },
    [taskId, sendPermissionResponse],
  );

  const handleOpenTask = useCallback(
    (newTaskId: string) => {
      router.replace(`/task/${newTaskId}`);
    },
    [router],
  );

  // Stale detection for local tasks: if no new S3 data arrives for 30s
  // while the agent is supposedly working, the desktop may be offline.
  const isLocal = task?.latest_run?.environment === "local";
  const prUrl = task?.latest_run?.output?.pr_url as string | undefined;
  const [isStale, setIsStale] = useState(false);
  useEffect(() => {
    if (!isLocal || !session?.isPromptPending) {
      setIsStale(false);
      return;
    }
    const interval = setInterval(() => {
      const lastEvent = session.lastEventAt ?? 0;
      setIsStale(lastEvent > 0 && Date.now() - lastEvent > 30_000);
    }, 5_000);
    return () => clearInterval(interval);
  }, [isLocal, session?.isPromptPending, session?.lastEventAt]);

  const handleContinueInCloud = useCallback(async () => {
    if (!taskId || !task) return;
    try {
      setRetrying(true);
      disconnectFromTask(taskId);
      const updatedTask = await runTaskInCloud(taskId, {
        resumeFromRunId: task.latest_run?.id,
      });
      setTask(updatedTask);
      await connectToTask(updatedTask);
      updateTaskInCache(updatedTask);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      log.error("Failed to continue in cloud", err);
      setRetrying(false);
      Alert.alert(
        "Failed to switch",
        "Could not continue this task in the cloud. Please try again.",
      );
    }
  }, [taskId, task, disconnectFromTask, connectToTask, updateTaskInCache]);

  const activityPhase = getSessionActivityPhase({ retrying, session });
  const isConnecting = activityPhase === "connecting";
  const isThinking = activityPhase === "working";
  const showAutomationContext =
    fromAutomation === "1" || task?.origin_product === "automation";
  const automationContextLabel =
    automationName ??
    (task?.origin_product === "automation"
      ? "This run was started from a task automation."
      : null);

  // Haptic pulse when connecting/thinking indicators dismiss
  const prevWaiting = useRef(false);
  useEffect(() => {
    const waiting = isConnecting || isThinking;
    if (prevWaiting.current && !waiting) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    prevWaiting.current = waiting;
  }, [isConnecting, isThinking]);

  if (error || (!task && !loading)) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-4">
        <FloatingBackButton />
        <Text className="mb-4 text-center text-status-error">
          {error || "Task not found"}
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="rounded-lg bg-gray-3 px-4 py-2"
        >
          <Text className="text-gray-12">Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <FloatingTaskHeader
        title={loading ? "Loading..." : task?.title || "Task"}
        subtitle={task?.repository ?? undefined}
        rightSlot={
          prUrl ? (
            <>
              <PrDiffStatsBadge prUrl={prUrl} />
              <PrStatusBadge prUrl={prUrl} />
            </>
          ) : isLocal ? (
            <Pressable
              onPress={() =>
                ActionSheetIOS.showActionSheetWithOptions(
                  {
                    options: ["Keep locally", "Move to Cloud"],
                    cancelButtonIndex: 0,
                    title: isStale
                      ? "Desktop may be offline"
                      : "Running on your desktop",
                  },
                  (index) => {
                    if (index === 1) handleContinueInCloud();
                  },
                )
              }
              className="rounded-full bg-gray-4 px-2.5 py-1"
            >
              <Text className="font-medium text-gray-11 text-xs">Local</Text>
            </Pressable>
          ) : null
        }
      />
      <Animated.View className="flex-1" style={contentPosition}>
        {showAutomationContext && automationContextLabel && (
          <View
            className="absolute inset-x-3 z-10 rounded-lg border border-accent-6 bg-accent-2 px-3 py-2"
            style={{ top: (Platform.OS === "ios" ? 6 : insets.top) + 52 }}
          >
            <Text className="text-accent-11 text-xs">
              {automationName
                ? `Started from automation: ${automationName}`
                : automationContextLabel}
            </Text>
          </View>
        )}

        {/* Always render TaskSessionView so the FlatList can layout behind
            the loading overlay. This prevents the "flash of messages" when
            switching from loading spinner to rendered content. The FlatList
            takes the available space above the composer (flex-1), so we
            don't need to reserve composer height as paddingTop — only the
            top header's space (paddingBottom in an inverted list) plus a
            small visual buffer at the bottom. */}
        <TaskSessionView
          events={session?.events ?? []}
          isConnecting={isConnecting}
          isThinking={isThinking}
          terminalStatus={retrying ? undefined : session?.terminalStatus}
          lastError={retrying ? undefined : session?.lastError}
          onRetry={
            !retrying && session?.terminalStatus ? handleRetry : undefined
          }
          onOpenTask={handleOpenTask}
          onSendPermissionResponse={handleSendPermissionResponse}
          contentContainerStyle={{
            paddingTop: 8,
            paddingBottom:
              (Platform.OS === "ios" ? 6 : insets.top) +
              60 +
              (showAutomationContext ? 44 : 0),
          }}
        />

        {/* Loading overlay — covers the list while it does initial layout */}
        {loading && (
          <View className="absolute inset-0 items-center justify-center bg-background">
            <ActivityIndicator size="large" color={themeColors.accent[9]} />
            <Text className="mt-4 text-gray-11">
              {task?.latest_run ? "Connecting..." : "Loading task..."}
            </Text>
          </View>
        )}

        {/* Composer below the list in flex flow — its real height
            determines how much vertical space the list above gets, so the
            last message can never sit behind the input. Stays visible on
            terminal runs so the user can send a follow-up that resumes. */}
        <Animated.View style={inputContainerStyle}>
          <TaskChatComposer
            onSend={handleSendPrompt}
            onStop={handleStop}
            isUserTurn={!(session?.isPromptPending ?? true)}
            placeholder={
              session?.terminalStatus ? "Resume this task..." : "Ask a question"
            }
            initialMessage={initialComposerMessage}
            mode={composerMode}
            model={composerModel}
            reasoning={composerReasoning}
            onModeChange={handleModeChange}
            onModelChange={handleModelChange}
            onReasoningChange={handleReasoningChange}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}
