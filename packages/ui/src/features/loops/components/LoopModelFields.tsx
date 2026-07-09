import type { LoopSchemas } from "@posthog/api-client/loops";
import { useModelCatalog } from "@posthog/ui/features/agent-applications/hooks/useModelCatalog";
import { SettingsOptionSelect } from "@posthog/ui/features/settings/SettingsOptionSelect";
import { Flex } from "@radix-ui/themes";
import { useMemo } from "react";
import { Field } from "./LoopFormPrimitives";

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
 * Static model configuration for a loop: model, adapter, and reasoning effort.
 * Loops have no live agent session, so the interactive
 * `UnifiedModelSelector`/`ReasoningLevelSelector` (which read a session's
 * `SessionConfigOption`) don't apply here, so this presents the same choices
 * as a dropdown against the served model catalog instead. The server validates
 * the final value against the catalog in `process_task/utils.py`.
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

  // Prefer the served catalog; fall back to the known level models while it
  // loads or if the endpoint is down. Always keep the current value selectable
  // so an existing loop's model never drops out of the list.
  const modelOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of catalog.models) {
      ids.add(entry.model);
    }
    if (ids.size === 0) {
      for (const level of Object.values(catalog.levels)) {
        for (const id of level) {
          ids.add(id);
        }
      }
    }
    if (model) {
      ids.add(model);
    }
    return Array.from(ids)
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({ value: id, label: id }));
  }, [catalog, model]);

  return (
    <Flex direction="column" gap="4">
      <Field
        label="Model"
        required
        hint="Validated against the available model catalog when the loop runs."
      >
        <SettingsOptionSelect
          value={model}
          options={modelOptions}
          placeholder="Select a model"
          onValueChange={onModelChange}
          disabled={disabled}
          ariaLabel="Model"
        />
      </Field>

      <Flex gap="4" wrap="wrap">
        <Field label="Adapter" className="min-w-[180px] flex-1">
          <SettingsOptionSelect
            value={adapter}
            options={ADAPTER_OPTIONS}
            onValueChange={(value) =>
              onAdapterChange(value as LoopSchemas.LoopRuntimeAdapterEnum)
            }
            disabled={disabled}
            ariaLabel="Adapter"
          />
        </Field>

        <Field label="Reasoning effort" className="min-w-[180px] flex-1">
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
        </Field>
      </Flex>
    </Flex>
  );
}
