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

const CLAUDE_MODEL_EFFORTS: Readonly<
  Record<string, readonly SupportedReasoningEffort[]>
> = {
  "claude-opus-4-7": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-4-8": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-4-6": ["low", "medium", "high"],
  "claude-sonnet-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-fable-5": ["low", "medium", "high", "xhigh", "max"],
  "@cf/zai-org/glm-5.2": ["high", "max"],
};

const EFFORT_NAMES: Record<SupportedReasoningEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export function getReasoningEffortOptions(
  adapter: Adapter,
  modelId: string,
): ReasoningEffortOption[] | null {
  if (adapter === "claude") {
    const efforts = CLAUDE_MODEL_EFFORTS[modelId];
    return (
      efforts?.map((value) => ({ value, name: EFFORT_NAMES[value] })) ?? null
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
