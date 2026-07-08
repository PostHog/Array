import type { LoopSchemas } from "@posthog/api-client/loops";
import { useModelCatalog } from "@posthog/ui/features/agent-applications/hooks/useModelCatalog";
import { SettingsOptionSelect } from "@posthog/ui/features/settings/SettingsOptionSelect";
import { Flex, Text, TextField } from "@radix-ui/themes";

const ADAPTER_OPTIONS: {
  value: LoopSchemas.LoopRuntimeAdapterEnum;
  label: string;
}[] = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
];

const AUTO_REASONING_VALUE = "auto";

const REASONING_EFFORT_OPTIONS: {
  value: LoopSchemas.LoopReasoningEffortEnum | typeof AUTO_REASONING_VALUE;
  label: string;
}[] = [
  { value: AUTO_REASONING_VALUE, label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
];

const MODEL_DATALIST_ID = "loop-model-suggestions";

interface LoopModelFieldsProps {
  adapter: LoopSchemas.LoopRuntimeAdapterEnum;
  model: string;
  reasoningEffort: LoopSchemas.LoopReasoningEffortEnum | null;
  onAdapterChange: (adapter: LoopSchemas.LoopRuntimeAdapterEnum) => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (
    effort: LoopSchemas.LoopReasoningEffortEnum | null,
  ) => void;
  disabled?: boolean;
}

/**
 * Static model configuration for a loop: adapter, model id, and reasoning
 * effort. Loops have no live agent session, so the interactive
 * `UnifiedModelSelector`/`ReasoningLevelSelector` (which read a session's
 * `SessionConfigOption`) don't apply here — this mirrors their fields
 * against the Loop schema instead. The model catalog (also used by
 * `AgentModelConfig`) seeds suggestions; the server validates the final
 * value against the model catalog in `process_task/utils.py`.
 */
export function LoopModelFields({
  adapter,
  model,
  reasoningEffort,
  onAdapterChange,
  onModelChange,
  onReasoningEffortChange,
  disabled,
}: LoopModelFieldsProps) {
  const { catalog } = useModelCatalog();

  return (
    <Flex direction="column" gap="3">
      <Flex gap="3" wrap="wrap">
        <Flex direction="column" gap="1" className="min-w-[180px] flex-1">
          <Text className="text-[12px] text-gray-10">Adapter</Text>
          <SettingsOptionSelect
            value={adapter}
            options={ADAPTER_OPTIONS}
            onValueChange={(value) =>
              onAdapterChange(value as LoopSchemas.LoopRuntimeAdapterEnum)
            }
            disabled={disabled}
            ariaLabel="Adapter"
          />
        </Flex>

        <Flex direction="column" gap="1" className="min-w-[180px] flex-1">
          <Text className="text-[12px] text-gray-10">Reasoning effort</Text>
          <SettingsOptionSelect
            value={reasoningEffort ?? AUTO_REASONING_VALUE}
            options={REASONING_EFFORT_OPTIONS}
            onValueChange={(value) =>
              onReasoningEffortChange(
                value === AUTO_REASONING_VALUE
                  ? null
                  : (value as LoopSchemas.LoopReasoningEffortEnum),
              )
            }
            disabled={disabled}
            ariaLabel="Reasoning effort"
          />
        </Flex>
      </Flex>

      <Flex direction="column" gap="1">
        <Text className="text-[12px] text-gray-10">Model</Text>
        <TextField.Root
          size="2"
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          placeholder="anthropic/claude-sonnet-4.6"
          disabled={disabled}
          list={MODEL_DATALIST_ID}
        />
        <datalist id={MODEL_DATALIST_ID}>
          {catalog.models.map((entry) => (
            <option key={entry.model} value={entry.model} />
          ))}
        </datalist>
      </Flex>
    </Flex>
  );
}
