import type { ModeInfo } from "@posthog/core/sessions/executionModes";
import {
  type CloudTaskConfigOption,
  isModalModelId,
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

/**
 * Drops the Kimi K3 model from the live model config when the feature flag is
 * off, and rewrites a persisted or server-default Kimi selection to the first
 * remaining option so it never leaks into the picker. Mirrors the desktop
 * `stripKimiModelOption` filter, but over the mobile `CloudTaskConfigOption`.
 */
export function filterKimiModelOption(
  modelOption: CloudTaskConfigOption,
  kimiEnabled: boolean,
): CloudTaskConfigOption {
  if (kimiEnabled) return modelOption;
  const options = modelOption.options.filter(
    (option) => !isModalModelId(option.value),
  );
  return {
    ...modelOption,
    options,
    currentValue: isModalModelId(modelOption.currentValue)
      ? (options[0]?.value ?? modelOption.currentValue)
      : modelOption.currentValue,
  };
}

/**
 * Applies {@link filterKimiModelOption} to the model option within a live
 * config set, leaving the other categories untouched. Callers filter once at
 * the source so the model auto-resolve effect and the picker share Kimi-free
 * options.
 */
export function filterKimiModelConfigOptions(
  configOptions: readonly CloudTaskConfigOption[],
  kimiEnabled: boolean,
): readonly CloudTaskConfigOption[] {
  if (kimiEnabled) return configOptions;
  return configOptions.map((option) =>
    option.category === "model" ? filterKimiModelOption(option, false) : option,
  );
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
  if (isRecording) return "mic-stop";
  if (canStop && (!allowSendWhileRunning || !hasContent)) return "stop";
  return hasContent ? "send" : "mic";
}
