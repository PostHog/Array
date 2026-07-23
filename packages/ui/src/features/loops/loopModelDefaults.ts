import type { LoopSchemas } from "@posthog/api-client/loops";

// Mirrors DEFAULT_MODEL_BY_RUNTIME_ADAPTER and the per-model effort tables in posthog's products/tasks/backend/temporal/process_task/utils.py.
export const LOOP_DEFAULT_MODEL_BY_ADAPTER: Record<
  LoopSchemas.LoopRuntimeAdapterEnum,
  string
> = {
  claude: "@cf/zai-org/glm-5.2",
  codex: "gpt-5",
};

const ALL_EFFORTS: LoopSchemas.LoopReasoningEffortEnum[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const LOW_TO_HIGH: LoopSchemas.LoopReasoningEffortEnum[] = [
  "low",
  "medium",
  "high",
];

const EFFORTS_BY_MODEL: Record<string, LoopSchemas.LoopReasoningEffortEnum[]> =
  {
    "@cf/zai-org/glm-5.2": ["high", "max"],
    "claude-opus-4-5": LOW_TO_HIGH,
    "claude-sonnet-4-6": LOW_TO_HIGH,
    "gpt-5": LOW_TO_HIGH,
    "gpt-5.5": ["low", "medium", "high", "xhigh"],
    "gpt-5.6-sol": ALL_EFFORTS,
    "gpt-5.6-terra": ALL_EFFORTS,
    "gpt-5.6-luna": ALL_EFFORTS,
  };

export function loopEffectiveModel(
  adapter: LoopSchemas.LoopRuntimeAdapterEnum,
  model: string,
): string {
  return model || LOOP_DEFAULT_MODEL_BY_ADAPTER[adapter];
}

export function loopSupportedReasoningEfforts(
  adapter: LoopSchemas.LoopRuntimeAdapterEnum,
  model: string,
): LoopSchemas.LoopReasoningEffortEnum[] {
  const efforts = EFFORTS_BY_MODEL[loopEffectiveModel(adapter, model)];
  if (efforts) return efforts;
  return adapter === "codex" ? LOW_TO_HIGH : ALL_EFFORTS;
}
