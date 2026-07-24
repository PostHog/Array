import { Text } from "@components/text";
import {
  DEFAULT_CLAUDE_EXECUTION_MODE,
  getAvailableModesForAdapter,
} from "@posthog/core/sessions/executionModes";
import { resolveCloudComposerModelChange } from "@posthog/core/task-detail/composerModelPolicy";
import {
  type Adapter,
  DEFAULT_GATEWAY_MODEL,
  DEFAULT_REASONING_EFFORT,
  type ExecutionMode,
  getReasoningEffortOptions,
  type SupportedReasoningEffort,
} from "@posthog/shared";
import * as Haptics from "expo-haptics";
import {
  ArrowUp,
  BrainIcon,
  Cpu,
  Lightning,
  Microphone,
  PaperclipIcon,
  PauseIcon,
  PencilIcon,
  Robot,
  ShieldCheck,
  Sparkle,
  Stack,
  Stop,
} from "phosphor-react-native";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useVoiceRecording } from "@/features/chat";
import { useCloudTaskConfigOptions } from "@/features/tasks/hooks/useCloudTaskConfigOptions";
import { logger } from "@/lib/logger";
import { useThemeColors } from "@/lib/theme";
import type { MessagingMode } from "../stores/messagingModeStore";
import { AttachmentSheet } from "./attachments/AttachmentSheet";
import { AttachmentsBar } from "./attachments/AttachmentsBar";
import {
  captureFromCamera,
  pickDocument,
  pickPhotoFromLibrary,
} from "./attachments/pickers";
import type { PendingAttachment } from "./attachments/types";
import {
  getComposerModelOptions,
  getConfigOptionLabel,
  getMobileExecutionModes,
  getModelConfigOption,
  resolveComposerPrimaryAction,
} from "./options";
import { Pill } from "./Pill";
import { SelectSheet } from "./SelectSheet";
import {
  type ComposerContent,
  isComposerEmpty,
  submitComposerMessage,
} from "./submitComposerMessage";

const log = logger.scope("task-chat-composer");
const SWITCH_ADAPTER_VALUE = "__switch_adapter__";
interface TaskChatComposerProps {
  onSend: (
    message: string,
    attachments: PendingAttachment[],
  ) => Promise<boolean>;
  onStop?: () => void;
  disabled?: boolean;
  placeholder?: string;
  initialMessage?: string;
  isUserTurn?: boolean;
  /** Current pill values (persisted per-task by the caller). */
  adapter: Adapter;
  mode: ExecutionMode;
  model: string;
  reasoning: SupportedReasoningEffort;
  onAdapterChange: (adapter: Adapter) => void;
  canChangeAdapter?: boolean;
  onModeChange: (mode: ExecutionMode) => void;
  onModelChange: (model: string) => void;
  onReasoningChange: (reasoning: SupportedReasoningEffort) => void;
  /** Steer vs Queue behaviour for messages sent while a turn is running. */
  messagingMode: MessagingMode;
  queuedCount: number;
  onToggleMessagingMode: () => void;
  /** A queued message pulled back for editing; pass a fresh object to restore. */
  restoredDraft?: { text: string; attachments: PendingAttachment[] };
  /** True while editing a queued message in place; the next send saves it. */
  editing?: boolean;
  onCancelEdit?: () => void;
}

function modeIcon(mode: ExecutionMode, color: string, size = 14): ReactNode {
  switch (mode) {
    case "plan":
      return <PauseIcon size={size} color={color} weight="bold" />;
    case "default":
      return <PencilIcon size={size} color={color} />;
    case "acceptEdits":
      return <ShieldCheck size={size} color={color} />;
    case "bypassPermissions":
    case "full-access":
      return <ShieldCheck size={size} color={color} weight="fill" />;
    case "read-only":
      return <PauseIcon size={size} color={color} />;
    case "auto":
      return <Sparkle size={size} color={color} weight="fill" />;
  }
}

function PulsingBorder({ active, color }: { active: boolean; color: string }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (active) {
      opacity.setValue(0);
      animRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      animRef.current.start();
    } else {
      animRef.current?.stop();
      animRef.current = null;
      opacity.setValue(0);
    }
    return () => {
      animRef.current?.stop();
    };
  }, [active, opacity]);

  if (!active) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity,
        borderWidth: 2,
        borderColor: color,
        borderRadius: 16,
      }}
    />
  );
}

export function TaskChatComposer({
  onSend,
  onStop,
  disabled = false,
  placeholder = "Ask a question",
  initialMessage,
  isUserTurn = false,
  adapter,
  mode,
  model,
  reasoning,
  onAdapterChange,
  canChangeAdapter = true,
  onModeChange,
  onModelChange,
  onReasoningChange,
  messagingMode,
  queuedCount,
  onToggleMessagingMode,
  restoredDraft,
  editing = false,
  onCancelEdit,
}: TaskChatComposerProps) {
  const themeColors = useThemeColors();
  const { configOptions, hasLiveConfig } = useCloudTaskConfigOptions(adapter);
  const executionModes = getMobileExecutionModes(
    getAvailableModesForAdapter(adapter),
  );
  const modelConfigOption = getModelConfigOption(configOptions);
  const mobileModelOptions = getComposerModelOptions(modelConfigOption);
  const [message, setMessage] = useState(() => initialMessage ?? "");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);

  // Mirror composer state into refs so a failed send can read the current
  // value after awaiting, rather than the value captured when it was sent.
  const messageRef = useRef(message);
  messageRef.current = message;
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const submissionRef = useRef(0);

  useEffect(() => {
    if (!initialMessage) return;
    setMessage(initialMessage);
  }, [initialMessage]);

  useEffect(() => {
    if (!restoredDraft) return;
    setMessage(restoredDraft.text);
    setAttachments(restoredDraft.attachments);
  }, [restoredDraft]);

  useEffect(() => {
    if (!hasLiveConfig) return;
    const next = resolveCloudComposerModelChange({
      adapter,
      modelOption: modelConfigOption,
      requestedModel: model,
      reasoning,
    });
    if (next.model !== model) onModelChange(next.model);
    if (next.reasoning !== reasoning) onReasoningChange(next.reasoning);
  }, [
    adapter,
    hasLiveConfig,
    model,
    modelConfigOption,
    onModelChange,
    onReasoningChange,
    reasoning,
  ]);

  const appendTranscript = useCallback((transcript: string) => {
    setMessage((prev) => (prev ? `${prev} ${transcript}` : transcript));
  }, []);

  const { status, startRecording, stopRecording, cancelRecording } =
    useVoiceRecording({ onTranscript: appendTranscript });

  const isRecording = status === "recording";
  const isTranscribing = status === "transcribing";

  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [reasoningSheetOpen, setReasoningSheetOpen] = useState(false);

  const reasoningOptions = getReasoningEffortOptions(adapter, model) ?? [];
  const showReasoningPill = reasoningOptions.length > 0;

  const hasContent = !isComposerEmpty({ text: message, attachments });
  const primaryAction = resolveComposerPrimaryAction({
    hasContent,
    disabled,
    isRecording,
    isTranscribing,
    canStop: !isUserTurn && !!onStop,
    allowSendWhileRunning: true,
  });
  const canSend = primaryAction === "send";
  const showStop = primaryAction === "stop";

  const applyContent = (content: ComposerContent) => {
    setMessage(content.text);
    setAttachments(content.attachments);
  };

  const handleSend = () => {
    if (!hasContent || disabled) return;
    const submitted: ComposerContent = { text: message.trim(), attachments };
    const submissionId = ++submissionRef.current;
    Keyboard.dismiss();
    void submitComposerMessage({
      submitted,
      clear: () => applyContent({ text: "", attachments: [] }),
      send: () => onSend(submitted.text, submitted.attachments),
      isLatestSubmission: () => submissionId === submissionRef.current,
      isEmpty: () =>
        isComposerEmpty({
          text: messageRef.current,
          attachments: attachmentsRef.current,
        }),
      restore: applyContent,
    });
  };

  const addAttachment = async (
    picker: () => Promise<PendingAttachment | null>,
  ) => {
    try {
      const att = await picker();
      if (att) setAttachments((prev) => [...prev, att]);
    } catch (err) {
      log.error("Failed to pick attachment", err);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleMicPress = async () => {
    if (isRecording) {
      await stopRecording();
    } else if (!isTranscribing) {
      await startRecording();
    }
  };

  const handleMicLongPress = async () => {
    if (isRecording) {
      await cancelRecording();
    }
  };

  const handleStop = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onStop?.();
  };

  const isSteer = messagingMode === "steer";
  const messagingModeLabel = isSteer
    ? "Steer"
    : queuedCount > 0
      ? `Queue (${queuedCount})`
      : "Queue";

  const handleToggleMessagingMode = () => {
    Haptics.selectionAsync();
    onToggleMessagingMode();
  };

  return (
    <>
      <View className="px-3">
        <View className="relative">
          <PulsingBorder active={isUserTurn} color={themeColors.accent[9]} />
          <View className="overflow-hidden rounded-2xl border border-gray-6 bg-card">
            {editing ? (
              <View className="flex-row items-center gap-2 border-gray-6 border-b bg-accent-2 px-3 py-2">
                <PencilIcon size={14} color={themeColors.accent[11]} />
                <Text className="flex-1 text-[12px] text-accent-11">
                  Editing queued message
                </Text>
                <Pressable
                  hitSlop={8}
                  onPress={onCancelEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel editing"
                  className="active:opacity-60"
                >
                  <Text className="font-medium text-[12px] text-gray-11">
                    Cancel
                  </Text>
                </Pressable>
              </View>
            ) : null}
            <AttachmentsBar
              attachments={attachments}
              onRemove={removeAttachment}
            />
            <TextInput
              className="px-4 pt-3.5 pb-3 text-[15px] text-gray-12"
              style={{ minHeight: 56, maxHeight: 200 }}
              placeholder={
                isRecording
                  ? "Recording..."
                  : isTranscribing
                    ? "Transcribing..."
                    : placeholder
              }
              placeholderTextColor={themeColors.gray[9]}
              value={message}
              onChangeText={setMessage}
              editable={!disabled && !isRecording}
              multiline
              textAlignVertical="top"
            />

            <View className="flex-row items-center gap-2 px-2 pb-2">
              <Pressable
                hitSlop={8}
                onPress={() => setAttachmentSheetOpen(true)}
                disabled={disabled || isRecording}
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
                  icon={
                    isSteer ? (
                      <Lightning
                        size={14}
                        color={themeColors.accent[11]}
                        weight="fill"
                      />
                    ) : (
                      <Stack size={14} color={themeColors.gray[11]} />
                    )
                  }
                  label={messagingModeLabel}
                  accent={isSteer}
                  onPress={handleToggleMessagingMode}
                />

                <Pill
                  icon={modeIcon(
                    mode,
                    mode === "plan"
                      ? themeColors.accent[11]
                      : themeColors.gray[11],
                  )}
                  label={
                    executionModes.find((option) => option.id === mode)?.name ??
                    mode
                  }
                  accent={mode === "plan"}
                  onPress={() => setModeSheetOpen(true)}
                />

                <Pill
                  icon={
                    adapter === "codex" ? (
                      <Cpu size={14} color={themeColors.gray[11]} />
                    ) : (
                      <Robot size={14} color={themeColors.gray[11]} />
                    )
                  }
                  label={
                    getConfigOptionLabel(modelConfigOption.options, model) ??
                    model
                  }
                  onPress={() => setModelSheetOpen(true)}
                />

                {showReasoningPill ? (
                  <Pill
                    icon={<BrainIcon size={14} color={themeColors.gray[11]} />}
                    label={
                      reasoningOptions.find(
                        (option) => option.value === reasoning,
                      )?.name ?? reasoning
                    }
                    onPress={() => setReasoningSheetOpen(true)}
                  />
                ) : null}
              </ScrollView>

              <Pressable
                onPress={
                  canSend ? handleSend : showStop ? handleStop : handleMicPress
                }
                onLongPress={handleMicLongPress}
                disabled={isTranscribing || disabled}
                className={`h-9 w-9 items-center justify-center rounded-lg ${
                  canSend ? "bg-gray-12" : "bg-gray-3"
                }`}
              >
                {isTranscribing ? (
                  <ActivityIndicator
                    size="small"
                    color={themeColors.gray[12]}
                  />
                ) : canSend ? (
                  <ArrowUp
                    size={18}
                    color={themeColors.background}
                    weight="bold"
                  />
                ) : isRecording || showStop ? (
                  <Stop
                    size={18}
                    color={themeColors.status.error}
                    weight="fill"
                  />
                ) : (
                  <Microphone size={18} color={themeColors.gray[12]} />
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      <SelectSheet
        open={modeSheetOpen}
        title="Execution mode"
        value={mode}
        onChange={(v) => onModeChange(v as ExecutionMode)}
        onClose={() => setModeSheetOpen(false)}
        options={executionModes.map((m) => ({
          value: m.id,
          label: m.name,
          description: m.description,
          icon: modeIcon(
            m.id as ExecutionMode,
            m.id === "plan" ? themeColors.accent[11] : themeColors.gray[11],
            16,
          ),
        }))}
      />

      <SelectSheet
        open={modelSheetOpen}
        title="Model"
        value={model}
        onChange={(v) => {
          if (v === SWITCH_ADAPTER_VALUE) {
            onAdapterChange(adapter === "claude" ? "codex" : "claude");
            return;
          }
          const next = resolveCloudComposerModelChange({
            adapter,
            modelOption: modelConfigOption,
            requestedModel: v,
            reasoning,
          });
          onModelChange(next.model);
          if (next.reasoning !== reasoning) {
            onReasoningChange(next.reasoning);
          }
        }}
        onClose={() => setModelSheetOpen(false)}
        options={[
          ...mobileModelOptions.map((m) => ({
            value: m.value,
            label: m.label,
            description: m.description,
            disabled: m.disabled,
            icon:
              adapter === "codex" ? (
                <Cpu size={16} color={themeColors.gray[11]} />
              ) : (
                <Robot size={16} color={themeColors.gray[11]} />
              ),
          })),
          ...(canChangeAdapter
            ? [
                {
                  value: SWITCH_ADAPTER_VALUE,
                  label: `Switch to ${adapter === "claude" ? "Codex" : "Claude Code"}`,
                  description: "Change coding agent",
                  disabled: false,
                  icon:
                    adapter === "claude" ? (
                      <Cpu size={16} color={themeColors.accent[11]} />
                    ) : (
                      <Robot size={16} color={themeColors.accent[11]} />
                    ),
                },
              ]
            : []),
        ]}
      />

      <SelectSheet
        open={reasoningSheetOpen}
        title="Reasoning"
        value={reasoning}
        onChange={(v) => onReasoningChange(v as SupportedReasoningEffort)}
        onClose={() => setReasoningSheetOpen(false)}
        options={reasoningOptions.map((r) => ({
          value: r.value,
          label: r.name,
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

export const TASK_CHAT_DEFAULTS = {
  mode: DEFAULT_CLAUDE_EXECUTION_MODE,
  model: DEFAULT_GATEWAY_MODEL,
  reasoning: DEFAULT_REASONING_EFFORT,
} as const;
