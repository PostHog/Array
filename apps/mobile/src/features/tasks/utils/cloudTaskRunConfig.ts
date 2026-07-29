import {
  type Adapter,
  type ExecutionMode,
  getReasoningEffortOptions,
  type SupportedReasoningEffort,
} from "@posthog/shared";

export function buildCloudTaskRunConfig({
  adapter,
  mode,
  model,
  reasoning,
}: {
  adapter: Adapter;
  mode: ExecutionMode;
  model: string;
  reasoning: SupportedReasoningEffort;
}) {
  return {
    adapter,
    model,
    reasoningLevel:
      getReasoningEffortOptions(adapter, model) === null
        ? undefined
        : reasoning,
    initialPermissionMode: mode,
  };
}
