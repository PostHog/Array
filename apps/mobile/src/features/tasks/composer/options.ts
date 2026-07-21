import {
  DEFAULT_CLAUDE_EXECUTION_MODE,
  getAvailableModes,
} from "@posthog/core/sessions/executionModes";
import {
  DEFAULT_GATEWAY_MODEL,
  DEFAULT_REASONING_EFFORT,
  defaultEligibleModel,
  getReasoningEffortOptions,
  type ExecutionMode as SharedExecutionMode,
  type SupportedReasoningEffort,
} from "@posthog/shared";

export type ExecutionMode = Extract<
  SharedExecutionMode,
  "default" | "acceptEdits" | "plan" | "auto"
>;
export type ReasoningEffort = SupportedReasoningEffort;

export const EXECUTION_MODES: {
  value: ExecutionMode;
  label: string;
  description: string;
}[] = getAvailableModes()
  .filter(
    (mode): mode is typeof mode & { id: ExecutionMode } =>
      mode.id === "default" ||
      mode.id === "acceptEdits" ||
      mode.id === "plan" ||
      mode.id === "auto",
  )
  .map((mode) => ({
    value: mode.id,
    label: mode.name,
    description: mode.description,
  }));

export interface ModelOption {
  value: string;
  label: string;
  description?: string;
  supportsReasoning: boolean;
}

export const MODELS: ModelOption[] = [
  {
    value: "claude-fable-5",
    label: "Claude Fable 5",
    description: "Newest, most capable",
    supportsReasoning: true,
  },
  {
    value: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    description: "Most capable, slower",
    supportsReasoning: true,
  },
  {
    value: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "Balanced, fast",
    supportsReasoning: true,
  },
  {
    value: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    description: "Balanced",
    supportsReasoning: true,
  },
];

export const DEFAULT_EXECUTION_MODE: ExecutionMode =
  DEFAULT_CLAUDE_EXECUTION_MODE;
export const DEFAULT_MODEL =
  defaultEligibleModel(DEFAULT_GATEWAY_MODEL) ??
  MODELS.find((model) => defaultEligibleModel(model.value))?.value ??
  DEFAULT_GATEWAY_MODEL;
export const DEFAULT_REASONING: ReasoningEffort = DEFAULT_REASONING_EFFORT;

export const REASONING_LEVELS: {
  value: ReasoningEffort;
  label: string;
}[] = (getReasoningEffortOptions("claude", DEFAULT_MODEL) ?? []).map(
  (option) => ({ value: option.value, label: option.name }),
);

export function modelLabel(value: string): string {
  return MODELS.find((m) => m.value === value)?.label ?? value;
}

export function modeLabel(value: ExecutionMode): string {
  return EXECUTION_MODES.find((m) => m.value === value)?.label ?? value;
}

export function reasoningLabel(value: ReasoningEffort): string {
  return REASONING_LEVELS.find((r) => r.value === value)?.label ?? value;
}

export function modelSupportsReasoning(value: string): boolean {
  return getReasoningEffortOptions("claude", value) !== null;
}
