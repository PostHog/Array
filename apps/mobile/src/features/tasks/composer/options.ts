export type ExecutionMode = "default" | "acceptEdits" | "plan";
export type ReasoningEffort = "low" | "medium" | "high";

export const EXECUTION_MODES: {
  value: ExecutionMode;
  label: string;
  description: string;
}[] = [
  {
    value: "plan",
    label: "Plan Mode",
    description: "Plan first, no tool execution",
  },
  {
    value: "default",
    label: "Default",
    description: "Standard behaviour, prompts for dangerous operations",
  },
  {
    value: "acceptEdits",
    label: "Accept Edits",
    description: "Auto-accept file edit operations",
  },
];

export interface ModelOption {
  value: string;
  label: string;
  description?: string;
  supportsReasoning: boolean;
}

export const MODELS: ModelOption[] = [
  {
    value: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    description: "Most capable, slower",
    supportsReasoning: true,
  },
  {
    value: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    description: "Balanced",
    supportsReasoning: true,
  },
  {
    value: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    description: "Fastest",
    supportsReasoning: false,
  },
];

export const REASONING_LEVELS: {
  value: ReasoningEffort;
  label: string;
}[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const DEFAULT_EXECUTION_MODE: ExecutionMode = "plan";
export const DEFAULT_MODEL = "claude-opus-4-7";
export const DEFAULT_REASONING: ReasoningEffort = "high";

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
  return MODELS.find((m) => m.value === value)?.supportsReasoning ?? false;
}
