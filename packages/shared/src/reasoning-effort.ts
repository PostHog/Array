import type { Adapter } from "./adapter";
import { EFFORT_LEVEL_LABELS, type EffortLevel } from "./domain-types";

export type SupportedReasoningEffort = EffortLevel;

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

const STANDARD_EFFORTS: readonly SupportedReasoningEffort[] = [
  "low",
  "medium",
  "high",
];
const EXTENDED_EFFORTS: readonly SupportedReasoningEffort[] = [
  ...STANDARD_EFFORTS,
  "xhigh",
  "max",
  "ultracode",
];

const CLAUDE_MODEL_EFFORTS: Readonly<
  Record<string, readonly SupportedReasoningEffort[]>
> = {
  "claude-opus-4-7": EXTENDED_EFFORTS,
  "claude-opus-4-8": EXTENDED_EFFORTS,
  "claude-sonnet-4-6": STANDARD_EFFORTS,
  "claude-sonnet-5": EXTENDED_EFFORTS,
  "claude-fable-5": EXTENDED_EFFORTS,
  "@cf/zai-org/glm-5.2": ["high", "max"],
  "claude-opus-5": EXTENDED_EFFORTS,
};

export function getReasoningEffortOptions(
  adapter: Adapter,
  modelId: string,
): ReasoningEffortOption[] | null {
  if (adapter === "claude") {
    const efforts = CLAUDE_MODEL_EFFORTS[modelId];
    return (
      efforts?.map((value) => ({ value, name: EFFORT_LEVEL_LABELS[value] })) ??
      null
    );
  }

  const options = [...BASE_OPTIONS];
  const normalizedModelId = modelId.toLowerCase();
  const supportsXhigh =
    normalizedModelId.includes("gpt-5.5") ||
    normalizedModelId.includes("gpt-5.6");

  if (supportsXhigh) {
    options.push({ value: "xhigh", name: "Extra High" });
  }
  if (adapter === "codex" && normalizedModelId.includes("gpt-5.6")) {
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
