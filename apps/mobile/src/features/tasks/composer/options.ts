import type { ModeInfo } from "@posthog/core/sessions/executionModes";
import {
  type CloudTaskConfigOption,
  isRestrictedModelOption,
} from "@posthog/shared";

export interface MobileModelOption {
  value: string;
  label: string;
  description?: string;
  disabled: boolean;
}

export function getMobileExecutionModes(
  modes: readonly ModeInfo[],
): ModeInfo[] {
  return modes.filter(
    (mode) => mode.id !== "bypassPermissions" && mode.id !== "full-access",
  );
}

export function getModelConfigOption(
  configOptions: readonly CloudTaskConfigOption[],
): CloudTaskConfigOption {
  const option = configOptions.find((item) => item.category === "model");
  if (!option) throw new Error("Cloud task model configuration is unavailable");
  return option;
}

export function getComposerModelOptions(
  modelOption: CloudTaskConfigOption,
): MobileModelOption[] {
  return modelOption.options.map((option) => ({
    value: option.value,
    label: option.name,
    description: option.description,
    disabled: isRestrictedModelOption(option._meta),
  }));
}

export function getConfigOptionLabel(
  options: ReadonlyArray<{ value: string; name: string }>,
  value: string | undefined,
): string | undefined {
  return options.find((option) => option.value === value)?.name ?? value;
}

export type ComposerPrimaryAction =
  | "send"
  | "stop"
  | "mic"
  | "mic-stop"
  | "disabled";

export function resolveComposerPrimaryAction({
  hasContent,
  disabled,
  isRecording,
  isTranscribing,
  canStop,
  allowSendWhileRunning,
}: {
  hasContent: boolean;
  disabled: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  canStop: boolean;
  allowSendWhileRunning: boolean;
}): ComposerPrimaryAction {
  if (disabled || isTranscribing) return "disabled";
  if (canStop && (!allowSendWhileRunning || !hasContent)) return "stop";
  if (hasContent && !isRecording) return "send";
  return isRecording ? "mic-stop" : "mic";
}
