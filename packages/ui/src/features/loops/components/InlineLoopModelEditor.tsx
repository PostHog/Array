import type { LoopSchemas } from "@posthog/api-client/loops";
import { LoopModelFields } from "./LoopModelFields";

export function InlineLoopModelEditor({
  adapter,
  model,
  reasoningEffort,
  disabled,
  onAdapterChange,
  onModelChange,
  onReasoningEffortChange,
}: {
  adapter: LoopSchemas.LoopRuntimeAdapterEnum;
  model: string;
  reasoningEffort: LoopSchemas.LoopReasoningEffortEnum | null;
  disabled?: boolean;
  onAdapterChange: (adapter: LoopSchemas.LoopRuntimeAdapterEnum) => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (
    effort: LoopSchemas.LoopReasoningEffortEnum | null,
  ) => void;
}) {
  return (
    <LoopModelFields
      adapter={adapter}
      model={model}
      reasoningEffort={reasoningEffort}
      onAdapterChange={onAdapterChange}
      onModelChange={onModelChange}
      onReasoningEffortChange={onReasoningEffortChange}
      disabled={disabled}
      inline
    />
  );
}
