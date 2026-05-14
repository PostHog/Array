import { Text } from "@components/text";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowUp,
  BrainIcon,
  CaretDown,
  GithubLogo,
  MicrophoneIcon,
  PaperclipIcon,
  PauseIcon,
  PencilIcon,
  Robot,
  ShieldCheck,
  StopIcon,
} from "phosphor-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import {
  useKeyboardHandler,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, { runOnJS, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useVoiceRecording } from "@/features/chat";
import { usePreferencesStore } from "@/features/preferences/stores/preferencesStore";
import { createTask, runTaskInCloud } from "@/features/tasks/api";
import { GitHubConnectionPrompt } from "@/features/tasks/components/GitHubConnectionPrompt";
import { GitHubLoadNotice } from "@/features/tasks/components/GitHubLoadNotice";
import { AttachmentSheet } from "@/features/tasks/composer/attachments/AttachmentSheet";
import { AttachmentsBar } from "@/features/tasks/composer/attachments/AttachmentsBar";
import { buildCloudPromptBlocks } from "@/features/tasks/composer/attachments/buildCloudPrompt";
import { serializeCloudPrompt } from "@/features/tasks/composer/attachments/cloudPrompt";
import {
  captureFromCamera,
  pickDocument,
  pickPhotoFromLibrary,
} from "@/features/tasks/composer/attachments/pickers";
import type { PendingAttachment } from "@/features/tasks/composer/attachments/types";
import { DotBackground } from "@/features/tasks/composer/DotBackground";
import {
  DEFAULT_EXECUTION_MODE,
  DEFAULT_MODEL,
  DEFAULT_REASONING,
  EXECUTION_MODES,
  type ExecutionMode,
  MODELS,
  modeLabel,
  modelLabel,
  modelSupportsReasoning,
  REASONING_LEVELS,
  type ReasoningEffort,
  reasoningLabel,
} from "@/features/tasks/composer/options";
import { Pill } from "@/features/tasks/composer/Pill";
import { RepositoryPickerSheet } from "@/features/tasks/composer/RepositoryPickerSheet";
import { SelectSheet } from "@/features/tasks/composer/SelectSheet";
import { useIntegrations } from "@/features/tasks/hooks/useIntegrations";
import { useTaskStore } from "@/features/tasks/stores/taskStore";
import type {
  CreateTaskOptions,
  RepositorySelection,
} from "@/features/tasks/types";
import {
  findRepositoryOption,
  isRepositorySelectionComplete,
  toRepositorySelection,
} from "@/features/tasks/utils/repositorySelection";
import { logger } from "@/lib/logger";
import { useThemeColors } from "@/lib/theme";

const log = logger.scope("task-create");

const SUGGESTIONS = [
  "Create or update my CLAUDE.md file",
  "Search for a TODO comment and fix it",
  "Recommend areas to improve our tests",
] as const;

function modeIcon(mode: ExecutionMode, color: string, size = 14) {
  switch (mode) {
    case "plan":
      return <PauseIcon size={size} color={color} weight="bold" />;
    case "default":
      return <PencilIcon size={size} color={color} />;
    case "acceptEdits":
      return <ShieldCheck size={size} color={color} />;
  }
}

export default function NewTaskScreen() {
  const {
    prompt: initialPrompt,
    repo: initialRepo,
    signalReport,
  } = useLocalSearchParams<{
    prompt?: string;
    repo?: string;
    signalReport?: string;
  }>();
  const router = useRouter();
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const keyboard = useReanimatedKeyboardAnimation();
  const restingBottom = insets.bottom + 12;
  const {
    error,
    hasGithubIntegration,
    repositoryOptions,
    repositoryWarning,
    isLoading,
    refetch,
  } = useIntegrations();

  const containerStyle = useAnimatedStyle(() => {
    const kbHeight = -keyboard.height.value;
    const progress = keyboard.progress.value;
    return {
      paddingBottom: kbHeight + restingBottom * (1 - progress),
    };
  });

  const suggestionsStyle = useAnimatedStyle(() => ({
    opacity: 1 - keyboard.progress.value,
  }));

  const [keyboardActive, setKeyboardActive] = useState(false);
  useKeyboardHandler(
    {
      onStart: (event) => {
        "worklet";
        runOnJS(setKeyboardActive)(event.height > 0);
      },
    },
    [],
  );

  // Default the repo to the URL param (deep-link from a signal report etc.),
  // falling back to the most recently used repo so the user doesn't have to
  // re-pick the same one for every new task.
  const lastRepository = useTaskStore((s) => s.lastRepository);
  const setLastRepository = useTaskStore((s) => s.setLastRepository);
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [selection, setSelectionState] = useState<RepositorySelection>(() => {
    if (initialRepo) {
      const match = repositoryOptions.find(
        (o) => o.repository.toLowerCase() === initialRepo.toLowerCase(),
      );
      if (match) return toRepositorySelection(match);
      // Repo known but integration not yet loaded — set repo, integrationId will resolve later
      return { integrationId: null, repository: initialRepo };
    }
    return lastRepository;
  });
  const setSelection = useCallback(
    (next: RepositorySelection) => {
      setSelectionState(next);
      setLastRepository(next);
    },
    [setLastRepository],
  );
  const [mode, setMode] = useState<ExecutionMode>(() => {
    const prefs = usePreferencesStore.getState();
    if (prefs.defaultInitialTaskMode === "last_used") {
      const last = prefs.lastNewTaskMode;
      const isValidMode = EXECUTION_MODES.some((m) => m.value === last);
      if (isValidMode) return last as ExecutionMode;
    }
    return DEFAULT_EXECUTION_MODE;
  });
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [reasoning, setReasoning] =
    useState<ReasoningEffort>(DEFAULT_REASONING);
  const [creating, setCreating] = useState(false);
  const [repoSheetOpen, setRepoSheetOpen] = useState(false);
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [reasoningSheetOpen, setReasoningSheetOpen] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);

  const appendTranscript = useCallback((transcript: string) => {
    setPrompt((prev) => (prev ? `${prev} ${transcript}` : transcript));
  }, []);

  const {
    status: voiceStatus,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceRecording({ onTranscript: appendTranscript });
  const isRecording = voiceStatus === "recording";
  const isTranscribing = voiceStatus === "transcribing";

  const handleMicPress = useCallback(async () => {
    if (isRecording) {
      await stopRecording();
    } else if (!isTranscribing) {
      await startRecording();
    }
  }, [isRecording, isTranscribing, startRecording, stopRecording]);

  const handleMicLongPress = useCallback(async () => {
    if (isRecording) {
      await cancelRecording();
    }
  }, [isRecording, cancelRecording]);

  const addAttachment = useCallback(
    async (picker: () => Promise<PendingAttachment | null>) => {
      try {
        const att = await picker();
        if (att) setAttachments((prev) => [...prev, att]);
      } catch (err) {
        log.error("Failed to pick attachment", err);
      }
    },
    [],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const selectedRepositoryOption = findRepositoryOption(
    repositoryOptions,
    selection,
  );
  const repositoryLabel = selectedRepositoryOption
    ? repositoryOptions.filter(
        (option) => option.repository === selectedRepositoryOption.repository,
      ).length > 1
      ? `${selectedRepositoryOption.repository} · ${selectedRepositoryOption.integrationLabel}`
      : selectedRepositoryOption.repository
    : "Select repository…";
  const repositoryLoadBlocked =
    !!repositoryWarning && repositoryOptions.length === 0;

  const handleCreateTask = useCallback(async () => {
    const hasContent = !!prompt.trim() || attachments.length > 0;
    if (!hasContent || !isRepositorySelectionComplete(selection) || creating) {
      return;
    }

    setCreating(true);

    try {
      const trimmedPrompt = prompt.trim();
      // The task description is plain text (it shows up as the task title and
      // in metadata). Attachments only enter the agent prompt via the cloud
      // payload below.
      const descriptionText =
        trimmedPrompt ||
        (attachments.length === 1
          ? `Attached: ${attachments[0].fileName}`
          : `Attached ${attachments.length} files`);

      const task = await createTask({
        description: descriptionText,
        title: descriptionText.slice(0, 100),
        repository: selection.repository ?? undefined,
        github_integration: selection.integrationId ?? undefined,
        ...(signalReport
          ? {
              origin_product: "signal_report",
              signal_report: signalReport,
              signal_report_task_relationship: "implementation",
            }
          : {}),
      } as CreateTaskOptions);

      const pendingUserMessage =
        attachments.length > 0
          ? serializeCloudPrompt(
              await buildCloudPromptBlocks(trimmedPrompt, attachments),
            )
          : trimmedPrompt;

      const supportsReasoning = modelSupportsReasoning(model);

      await runTaskInCloud(task.id, {
        pendingUserMessage,
        runtimeAdapter: "claude",
        model,
        reasoningEffort: supportsReasoning ? reasoning : undefined,
        initialPermissionMode: mode,
        ...(signalReport
          ? {
              runSource: "signal_report" as const,
              signalReportId: signalReport,
            }
          : {}),
      });

      router.replace(`/task/${task.id}`);
    } catch (creationError) {
      log.error("Failed to create task", creationError);
    } finally {
      setCreating(false);
    }
  }, [
    attachments,
    creating,
    mode,
    model,
    prompt,
    reasoning,
    router,
    selection,
    signalReport,
  ]);

  const hasContent = !!prompt.trim() || attachments.length > 0;
  const canSubmit =
    hasContent && isRepositorySelectionComplete(selection) && !creating;
  const showReasoningPill = modelSupportsReasoning(model);

  if (isLoading && hasGithubIntegration === null) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: "New task",
            headerStyle: { backgroundColor: themeColors.background },
            headerTintColor: themeColors.gray[12],
            presentation: "modal",
          }}
        />
        <View className="flex-1 items-center justify-center bg-background">
          <ActivityIndicator size="large" color={themeColors.accent[9]} />
          <Text className="mt-4 text-gray-11">Loading repositories...</Text>
        </View>
      </>
    );
  }

  if (error || repositoryLoadBlocked) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: "New task",
            headerStyle: { backgroundColor: themeColors.background },
            headerTintColor: themeColors.gray[12],
            presentation: "modal",
          }}
        />
        <View className="flex-1 justify-center bg-background px-4">
          <GitHubLoadNotice
            message={
              error ??
              repositoryWarning ??
              "Could not load GitHub repositories."
            }
            onRetry={refetch}
          />
        </View>
      </>
    );
  }

  if (hasGithubIntegration === false) {
    return (
      <View className="flex-1 bg-background">
        <View style={{ paddingTop: insets.top + 56 }} className="flex-1">
          <GitHubConnectionPrompt
            onConnected={refetch}
            title="Connect GitHub to continue"
            description="You need to connect your GitHub account before creating tasks. This allows PostHog to work on your repositories."
          />
        </View>
      </View>
    );
  }

  return (
    <>
      <View className="flex-1 bg-background">
        <DotBackground />

        <Animated.View style={[{ flex: 1 }, containerStyle]}>
          <View className="flex-1 items-stretch justify-center px-3">
            {prompt.trim().length === 0 ? (
              <Animated.View
                style={suggestionsStyle}
                pointerEvents={keyboardActive ? "none" : "auto"}
              >
                <Text className="mb-3 px-1 text-[13px] text-gray-10">
                  Suggestions
                </Text>
                <View className="gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <Pressable
                      key={suggestion}
                      onPress={() => setPrompt(suggestion)}
                      className="rounded-2xl border border-gray-6 bg-card px-4 py-3 active:bg-gray-2"
                    >
                      <Text className="text-[14px] text-gray-12">
                        {suggestion}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </Animated.View>
            ) : null}
          </View>

          <View className="px-3">
            {repositoryWarning ? (
              <GitHubLoadNotice
                message={repositoryWarning}
                onRetry={refetch}
                tone="warning"
              />
            ) : null}

            <View className="mb-2 flex-row">
              <Pressable
                onPress={() => setRepoSheetOpen(true)}
                className="flex-row items-center gap-2 rounded-full border border-gray-6 bg-card py-1.5 pr-2.5 pl-2 active:bg-gray-2"
              >
                <GithubLogo
                  size={16}
                  color={
                    selectedRepositoryOption
                      ? themeColors.gray[12]
                      : themeColors.gray[10]
                  }
                  weight={selectedRepositoryOption ? "fill" : "regular"}
                />
                <Text
                  className={`text-[13px] ${
                    selectedRepositoryOption ? "text-gray-12" : "text-gray-10"
                  }`}
                  numberOfLines={1}
                >
                  {repositoryLabel}
                </Text>
                <CaretDown size={12} color={themeColors.gray[10]} />
              </Pressable>
            </View>

            <View className="overflow-hidden rounded-2xl border border-gray-6 bg-card">
              <AttachmentsBar
                attachments={attachments}
                onRemove={removeAttachment}
              />
              <TextInput
                className="px-4 pt-3.5 pb-3 text-[15px] text-gray-12"
                style={{ minHeight: 56, maxHeight: 200 }}
                placeholder="Describe what you want to build…"
                placeholderTextColor={themeColors.gray[9]}
                value={prompt}
                onChangeText={setPrompt}
                multiline
                textAlignVertical="top"
              />

              <View className="flex-row items-center gap-2 px-2 pb-2">
                <Pressable
                  hitSlop={8}
                  onPress={() => setAttachmentSheetOpen(true)}
                  accessibilityLabel="Add attachment"
                  accessibilityRole="button"
                  className="h-9 w-9 items-center justify-center active:opacity-60"
                >
                  <PaperclipIcon
                    size={18}
                    color={
                      attachments.length > 0
                        ? themeColors.accent[11]
                        : themeColors.gray[10]
                    }
                    weight={attachments.length > 0 ? "fill" : "regular"}
                  />
                </Pressable>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  className="flex-1"
                  contentContainerStyle={{
                    alignItems: "center",
                    gap: 6,
                    paddingRight: 4,
                  }}
                >
                  <Pill
                    icon={modeIcon(
                      mode,
                      mode === "plan"
                        ? themeColors.accent[11]
                        : themeColors.gray[11],
                    )}
                    label={modeLabel(mode)}
                    accent={mode === "plan"}
                    onPress={() => setModeSheetOpen(true)}
                  />

                  <Pill
                    icon={<Robot size={14} color={themeColors.gray[11]} />}
                    label={modelLabel(model)}
                    onPress={() => setModelSheetOpen(true)}
                  />

                  {showReasoningPill ? (
                    <Pill
                      icon={
                        <BrainIcon size={14} color={themeColors.gray[11]} />
                      }
                      label={reasoningLabel(reasoning)}
                      onPress={() => setReasoningSheetOpen(true)}
                    />
                  ) : null}
                </ScrollView>

                <Pressable
                  onPress={
                    isTranscribing
                      ? undefined
                      : isRecording
                        ? handleMicPress
                        : hasContent
                          ? handleCreateTask
                          : handleMicPress
                  }
                  onLongPress={handleMicLongPress}
                  disabled={
                    isTranscribing || (hasContent && !canSubmit && !isRecording)
                  }
                  accessibilityLabel={
                    isRecording
                      ? "Stop recording"
                      : hasContent
                        ? "Create task"
                        : "Record voice"
                  }
                  className={`h-9 w-9 items-center justify-center rounded-lg ${
                    canSubmit || isRecording || (!hasContent && !isTranscribing)
                      ? "bg-gray-12"
                      : "bg-gray-5"
                  }`}
                >
                  {creating || isTranscribing ? (
                    <ActivityIndicator
                      size="small"
                      color={themeColors.background}
                    />
                  ) : isRecording ? (
                    <StopIcon
                      size={18}
                      color={themeColors.status.error}
                      weight="fill"
                    />
                  ) : hasContent ? (
                    <ArrowUp
                      size={18}
                      color={
                        canSubmit ? themeColors.background : themeColors.gray[9]
                      }
                      weight="bold"
                    />
                  ) : (
                    <MicrophoneIcon size={18} color={themeColors.background} />
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Animated.View>
      </View>

      <RepositoryPickerSheet
        open={repoSheetOpen}
        repositoryOptions={repositoryOptions}
        selected={selectedRepositoryOption}
        loading={isLoading}
        onChange={(option) => setSelection(toRepositorySelection(option))}
        onClose={() => setRepoSheetOpen(false)}
      />

      <SelectSheet
        open={modeSheetOpen}
        title="Execution mode"
        value={mode}
        onChange={(value) => {
          const next = value as ExecutionMode;
          setMode(next);
          usePreferencesStore.getState().setLastNewTaskMode(next);
        }}
        onClose={() => setModeSheetOpen(false)}
        options={EXECUTION_MODES.map((executionMode) => ({
          value: executionMode.value,
          label: executionMode.label,
          description: executionMode.description,
          icon: modeIcon(
            executionMode.value,
            executionMode.value === "plan"
              ? themeColors.accent[11]
              : themeColors.gray[11],
            16,
          ),
        }))}
      />

      <SelectSheet
        open={modelSheetOpen}
        title="Model"
        value={model}
        onChange={(value) => {
          setModel(value);
          if (!modelSupportsReasoning(value)) {
            setReasoning(DEFAULT_REASONING);
          }
        }}
        onClose={() => setModelSheetOpen(false)}
        options={MODELS.map((modelOption) => ({
          value: modelOption.value,
          label: modelOption.label,
          description: modelOption.description,
          icon: <Robot size={16} color={themeColors.gray[11]} />,
        }))}
      />

      <SelectSheet
        open={reasoningSheetOpen}
        title="Reasoning"
        value={reasoning}
        onChange={(value) => setReasoning(value as ReasoningEffort)}
        onClose={() => setReasoningSheetOpen(false)}
        options={REASONING_LEVELS.map((reasoningLevel) => ({
          value: reasoningLevel.value,
          label: reasoningLevel.label,
          icon: <BrainIcon size={16} color={themeColors.gray[11]} />,
        }))}
      />

      <AttachmentSheet
        open={attachmentSheetOpen}
        onClose={() => setAttachmentSheetOpen(false)}
        onPickPhoto={() => addAttachment(pickPhotoFromLibrary)}
        onPickCamera={() => addAttachment(captureFromCamera)}
        onPickDocument={() => addAttachment(pickDocument)}
      />
    </>
  );
}
