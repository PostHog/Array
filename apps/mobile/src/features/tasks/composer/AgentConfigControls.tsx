import { getAvailableModesForAdapter } from "@posthog/core/sessions/executionModes";
import {
  type CloudComposerSelection,
  resolveCloudComposerAdapterChange,
  resolveCloudComposerModelChange,
} from "@posthog/core/task-detail/composerModelPolicy";
import {
  type Adapter,
  type CloudTaskConfigOption,
  type ExecutionMode,
  getReasoningEffortOptions,
  type SupportedReasoningEffort,
} from "@posthog/shared";
import {
  BrainIcon,
  Cpu,
  PauseIcon,
  PencilIcon,
  Robot,
  ShieldCheck,
  Sparkle,
} from "phosphor-react-native";
import { type ReactNode, useState } from "react";
import { useThemeColors } from "@/lib/theme";
import {
  getComposerModelOptions,
  getConfigOptionLabel,
  getMobileExecutionModes,
  getModelConfigOption,
} from "./options";
import { Pill } from "./Pill";
import { SelectSheet } from "./SelectSheet";

const SWITCH_ADAPTER_VALUE = "__switch_adapter__";

interface AgentConfigControlsProps {
  adapter: Adapter;
  mode: ExecutionMode;
  model: string;
  reasoning: SupportedReasoningEffort;
  configOptions: readonly CloudTaskConfigOption[];
  onAdapterChange: (selection: CloudComposerSelection) => void;
  onModeChange: (mode: ExecutionMode) => void;
  onModelChange: (model: string) => void;
  onReasoningChange: (reasoning: SupportedReasoningEffort) => void;
  canChangeAdapter?: boolean;
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

export function AgentConfigControls({
  adapter,
  mode,
  model,
  reasoning,
  configOptions,
  onAdapterChange,
  onModeChange,
  onModelChange,
  onReasoningChange,
  canChangeAdapter = true,
}: AgentConfigControlsProps) {
  const themeColors = useThemeColors();
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [reasoningSheetOpen, setReasoningSheetOpen] = useState(false);
  const executionModes = getMobileExecutionModes(
    getAvailableModesForAdapter(adapter),
  );
  const modelConfigOption = getModelConfigOption(configOptions);
  const modelOptions = getComposerModelOptions(modelConfigOption);
  const reasoningOptions = getReasoningEffortOptions(adapter, model) ?? [];

  return (
    <>
      <Pill
        icon={modeIcon(
          mode,
          mode === "plan" ? themeColors.accent[11] : themeColors.gray[11],
        )}
        label={
          executionModes.find((option) => option.id === mode)?.name ?? mode
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
        label={getConfigOptionLabel(modelConfigOption.options, model) ?? model}
        onPress={() => setModelSheetOpen(true)}
      />

      {reasoningOptions.length > 0 ? (
        <Pill
          icon={<BrainIcon size={14} color={themeColors.gray[11]} />}
          label={
            reasoningOptions.find((option) => option.value === reasoning)
              ?.name ?? reasoning
          }
          onPress={() => setReasoningSheetOpen(true)}
        />
      ) : null}

      <SelectSheet
        open={modeSheetOpen}
        title="Execution mode"
        value={mode}
        onChange={(value) => onModeChange(value as ExecutionMode)}
        onClose={() => setModeSheetOpen(false)}
        options={executionModes.map((option) => ({
          value: option.id,
          label: option.name,
          description: option.description,
          icon: modeIcon(
            option.id as ExecutionMode,
            option.id === "plan"
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
          if (value === SWITCH_ADAPTER_VALUE) {
            onAdapterChange(resolveCloudComposerAdapterChange(adapter));
            return;
          }
          const next = resolveCloudComposerModelChange({
            adapter,
            modelOption: modelConfigOption,
            requestedModel: value,
            reasoning,
          });
          onModelChange(next.model);
          onReasoningChange(next.reasoning);
        }}
        onClose={() => setModelSheetOpen(false)}
        options={[
          ...modelOptions.map((option) => ({
            value: option.value,
            label: option.label,
            description: option.description,
            disabled: option.disabled,
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
        onChange={(value) =>
          onReasoningChange(value as SupportedReasoningEffort)
        }
        onClose={() => setReasoningSheetOpen(false)}
        options={reasoningOptions.map((option) => ({
          value: option.value,
          label: option.name,
          icon: <BrainIcon size={16} color={themeColors.gray[11]} />,
        }))}
      />
    </>
  );
}
