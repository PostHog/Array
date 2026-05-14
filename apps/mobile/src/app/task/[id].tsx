import { Text } from "@components/text";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Pressable,
  View,
} from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Composer } from "@/features/chat";
import {
  createWatchMissionEnvelope,
  getTask,
  isWatchMissionControlSupported,
  runTaskInCloud,
  sendUrgentWatchMissionUpdate,
  type Task,
  TaskSessionView,
  taskKeys,
  useTaskSessionStore,
} from "@/features/tasks";
import { logger } from "@/lib/logger";
import { useThemeColors } from "@/lib/theme";

const log = logger.scope("task-detail");

const VISIBLE_AGENT_OUTPUT_TYPES = new Set([
  "agent_message_chunk",
  "agent_message",
  "agent_thought_chunk",
  "tool_call",
]);

export default function TaskDetailScreen() {
  const { id: taskId } = useLocalSearchParams<{ id: string }>();
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
    getSessionForTask,
    setActiveWatchTask,
    registerWatchTask,
  } = useTaskSessionStore();

  const session = taskId ? getSessionForTask(taskId) : undefined;

  const connectFetchedTask = useCallback(
    async (fetchedTask: Task) => {
      setTask(fetchedTask);
      registerWatchTask(fetchedTask);
      setActiveWatchTask(fetchedTask.id);
      await connectToTask(fetchedTask);
    },
    [connectToTask, registerWatchTask, setActiveWatchTask],
  );

  const { height } = useReanimatedKeyboardAnimation();

  // useReanimatedKeyboardAnimation returns negative height values
  // e.g., -300 when keyboard is open, 0 when closed
  const contentPosition = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: height.value }],
    };
  }, []);

  const inputContainerStyle = useAnimatedStyle(() => {
    return {
      marginBottom: height.value < 0 ? 26 : Math.max(insets.bottom, 50),
    };
  }, [insets.bottom]);

  useEffect(() => {
    if (!taskId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getTask(taskId)
      .then((fetchedTask) => {
        if (cancelled) return;
        return connectFetchedTask(fetchedTask);
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
  }, [taskId, connectFetchedTask, disconnectFromTask]);

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
        return connectFetchedTask(freshTask);
      })
      .catch((err) => {
        if (cancelled) return;
        log.error("Failed to reconnect to task", err);
      });

    return () => {
      cancelled = true;
    };
  }, [taskId, task, loading, session, connectFetchedTask, retrying]);

  const handleSendPrompt = useCallback(
    (text: string) => {
      if (!taskId) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      sendPrompt(taskId, text).catch((err) => {
        log.error("Failed to send prompt", err);
        Alert.alert(
          "Failed to send",
          "Your message could not be delivered. Please try again.",
        );
      });
    },
    [taskId, sendPrompt],
  );

  const handleStop = useCallback(() => {
    if (!taskId) return;
    // cancelPrompt returns false on failure — no need to alert,
    // the agent may have already finished or the sandbox expired.
    cancelPrompt(taskId).catch(() => {});
  }, [taskId, cancelPrompt]);

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

  const runCurrentTaskInCloud = useCallback(async () => {
    if (!taskId || !task) return null;

    setRetrying(true);
    disconnectFromTask(taskId);

    const updatedTask = await runTaskInCloud(taskId, {
      resumeFromRunId: task.latest_run?.id,
    });
    setTask(updatedTask);
    await connectToTask(updatedTask);
    updateTaskInCache(updatedTask);
    return updatedTask;
  }, [taskId, task, disconnectFromTask, connectToTask, updateTaskInCache]);

  const handleRetry = useCallback(async () => {
    try {
      const updatedTask = await runCurrentTaskInCloud();
      if (!updatedTask) return;
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
  }, [runCurrentTaskInCloud]);

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

  const handleSendWatchDemo = useCallback(async () => {
    if (!task || !taskId) return;

    try {
      registerWatchTask(task);
      setActiveWatchTask(task.id);
      const supported = await isWatchMissionControlSupported();
      if (!supported) {
        Alert.alert(
          "Watch unavailable",
          "WatchConnectivity is not available on this device.",
        );
        return;
      }

      const envelope = createWatchMissionEnvelope(
        [task],
        { [task.id]: session },
        task.id,
        { now: Date.now() },
      );
      const sent = await sendUrgentWatchMissionUpdate(envelope);
      Alert.alert(
        sent ? "Sent to Watch" : "Watch send failed",
        sent
          ? "Sent the current task snapshot to the watch app."
          : "The native bridge did not accept the watch update.",
      );
    } catch (err) {
      log.error("Failed to send watch demo update", err);
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert("Watch send failed", message);
    }
  }, [task, taskId, session, registerWatchTask, setActiveWatchTask]);

  // Stale detection for local tasks: if no new S3 data arrives for 30s
  // while the agent is supposedly working, the desktop may be offline.
  const isLocal = task?.latest_run?.environment === "local";
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
    try {
      const updatedTask = await runCurrentTaskInCloud();
      if (!updatedTask) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      log.error("Failed to continue in cloud", err);
      setRetrying(false);
      Alert.alert(
        "Failed to switch",
        "Could not continue this task in the cloud. Please try again.",
      );
    }
  }, [runCurrentTaskInCloud]);

  const environment = task?.latest_run?.environment;

  const showLocalRunOptions = useCallback(() => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ["Keep locally", "Move to Cloud"],
        cancelButtonIndex: 0,
        title: isStale ? "Desktop may be offline" : "Running on your desktop",
      },
      (index) => {
        if (index === 1) handleContinueInCloud();
      },
    );
  }, [handleContinueInCloud, isStale]);

  const renderEnvironmentBadge = useCallback(() => {
    if (!environment) return null;

    const isCloud = environment === "cloud";
    return (
      <Pressable
        onPress={isLocal ? showLocalRunOptions : undefined}
        className={`rounded-full px-3 py-1 ${isCloud ? "bg-accent-3" : "bg-gray-4"}`}
      >
        <Text
          className={`font-medium text-xs ${isCloud ? "text-accent-11" : "text-gray-11"}`}
        >
          {isCloud ? "Cloud" : "Local"}
        </Text>
      </Pressable>
    );
  }, [environment, isLocal, showLocalRunOptions]);

  const hasAnyAgentOutput =
    session?.events.some((e) => {
      if (e.type !== "session_update") return false;
      const su = (e.notification as Record<string, unknown>)?.update;
      return VISIBLE_AGENT_OUTPUT_TYPES.has(
        (su as Record<string, unknown>)?.sessionUpdate as string,
      );
    }) ?? false;

  const isConnecting =
    retrying || (!!session?.awaitingAgentOutput && !hasAnyAgentOutput);
  const isThinking = !!session?.awaitingAgentOutput && hasAnyAgentOutput;

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
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTransparent: false,
            headerTitle: "Error",
            headerStyle: { backgroundColor: themeColors.background },
            headerTintColor: themeColors.gray[12],
            presentation: "modal",
          }}
        />
        <View className="flex-1 items-center justify-center bg-background px-4">
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
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: false,
          headerTitle: loading ? "Loading..." : task?.title || "Task",
          headerStyle: { backgroundColor: themeColors.background },
          headerTintColor: themeColors.gray[12],
          headerTitleStyle: {
            fontWeight: "600",
          },
          presentation: "modal",
          headerRight: environment ? renderEnvironmentBadge : undefined,
        }}
      />
      <Animated.View className="flex-1 bg-background" style={contentPosition}>
        {task && !loading && (
          <View className="absolute top-3 right-3 z-10">
            <Pressable
              onPress={handleSendWatchDemo}
              className="rounded-full bg-accent-9 px-3 py-2 shadow-sm"
            >
              <Text className="font-medium text-white text-xs">
                Send to Watch
              </Text>
            </Pressable>
          </View>
        )}

        {/* Always render TaskSessionView so the FlatList can layout behind
            the loading overlay. This prevents the "flash of messages" when
            switching from loading spinner to rendered content. */}
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
            paddingTop:
              session?.terminalStatus && !retrying ? 16 : 80 + insets.bottom,
            paddingBottom: 16,
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

        {/* Fixed input at bottom — hidden when run is terminal */}
        {!session?.terminalStatus && (
          <Animated.View
            className="absolute inset-x-0 bottom-0"
            style={inputContainerStyle}
          >
            <Composer
              onSend={handleSendPrompt}
              onStop={handleStop}
              isUserTurn={!(session?.isPromptPending ?? true)}
              placeholder="Ask a question"
            />
          </Animated.View>
        )}
      </Animated.View>
    </>
  );
}
