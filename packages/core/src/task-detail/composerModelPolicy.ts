import {
  type Adapter,
  type CloudTaskConfigOption,
  DEFAULT_REASONING_EFFORT,
  isRestrictedModelOption,
  isSupportedReasoningEffort,
  type SupportedReasoningEffort,
} from "@posthog/shared";

export function resolveCloudComposerModelChange({
  adapter,
  modelOption,
  requestedModel,
  reasoning,
}: {
  adapter: Adapter;
  modelOption: CloudTaskConfigOption;
  requestedModel: string;
  reasoning: SupportedReasoningEffort;
}): { model: string; reasoning: SupportedReasoningEffort } {
  const selected = modelOption.options.find(
    (option) => option.value === requestedModel,
  );
  const model =
    selected && !isRestrictedModelOption(selected._meta)
      ? requestedModel
      : modelOption.currentValue;

  return {
    model,
    reasoning: isSupportedReasoningEffort(adapter, model, reasoning)
      ? reasoning
      : DEFAULT_REASONING_EFFORT,
  };
}
