import type { Adapter } from "./adapter";

export type SupportedReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export const DEFAULT_REASONING_EFFORT: SupportedReasoningEffort = "high";

export interface ReasoningEffortOption {
  value: SupportedReasoningEffort;
  name: string;
}

const BASE_OPTIONS: ReasoningEffortOption[] = [
  { value: "low", name: "Low" },
  { value: "medium", name: "Medium" },
  { value: "high", name: "High" },
];

const CLAUDE_MODELS_WITH_EFFORT = new Set([
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-fable-5",
]);

const CLAUDE_MODELS_WITH_XHIGH_EFFORT = new Set([
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-fable-5",
]);

export function getReasoningEffortOptions(
  adapter: Adapter,
  modelId: string,
): ReasoningEffortOption[] | null {
  if (adapter === "claude" && !CLAUDE_MODELS_WITH_EFFORT.has(modelId)) {
    return null;
  }

  const options = [...BASE_OPTIONS];
  const normalizedModelId = modelId.toLowerCase();
  const supportsXhigh =
    adapter === "claude"
      ? CLAUDE_MODELS_WITH_XHIGH_EFFORT.has(modelId)
      : normalizedModelId.includes("gpt-5.5") ||
        normalizedModelId.includes("gpt-5.6");

  if (supportsXhigh) {
    options.push({ value: "xhigh", name: "Extra High" });
  }
  if (
    (adapter === "claude" && supportsXhigh) ||
    (adapter === "codex" && normalizedModelId.includes("gpt-5.6"))
  ) {
    options.push({ value: "max", name: "Max" });
  }

  return options;
}

export function isSupportedReasoningEffort(
  adapter: Adapter,
  modelId: string,
  value: string,
): value is SupportedReasoningEffort {
  return (
    getReasoningEffortOptions(adapter, modelId)?.some(
      (option) => option.value === value,
    ) ?? false
  );
}
