import type { LoopSchemas } from "@posthog/api-client/loops";
import { useModelCatalog } from "@posthog/ui/features/agent-applications/hooks/useModelCatalog";
import { SettingsOptionSelect } from "@posthog/ui/features/settings/SettingsOptionSelect";
import { Flex } from "@radix-ui/themes";
import { useMemo } from "react";
import { loopSupportedReasoningEfforts } from "../loopModelDefaults";
import { Field } from "./LoopFormPrimitives";

const ADAPTER_OPTIONS: {
  value: LoopSchemas.LoopRuntimeAdapterEnum;
  label: string;
}[] = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
];

const AUTO_REASONING_VALUE = "auto";
const DEFAULT_MODEL_VALUE = "__default__";

const REASONING_EFFORT_LABELS: Record<
  LoopSchemas.LoopReasoningEffortEnum,
  string
> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

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
 * the final value against the catalog in `process_task/utils.py`. The catalog
 * is deliberately not filtered by the session composer's GLM feature flag:
 * GLM is the loop fire-time default, so hiding it here would hide the default.
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
    const catalogOptions = Array.from(ids)
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({ value: id, label: id }));
    return [
      { value: DEFAULT_MODEL_VALUE, label: "Default (recommended)" },
      ...catalogOptions,
    ];
  }, [catalog, model]);

  // The current effort stays selectable even when the effective model no longer
  // supports it (a loop saved under an older default), same as the model list.
  const reasoningEffortOptions = useMemo(() => {
    const supported = loopSupportedReasoningEfforts(adapter, model);
    const efforts =
      reasoningEffort && !supported.includes(reasoningEffort)
        ? [...supported, reasoningEffort]
        : supported;
    return [
      { value: AUTO_REASONING_VALUE, label: "Auto" },
      ...efforts.map((effort) => ({
        value: effort,
        label: REASONING_EFFORT_LABELS[effort],
      })),
    ];
  }, [adapter, model, reasoningEffort]);

  const clearUnsupportedEffort = (
    nextAdapter: LoopSchemas.LoopRuntimeAdapterEnum,
    nextModel: string,
  ) => {
    if (
      reasoningEffort &&
      !loopSupportedReasoningEfforts(nextAdapter, nextModel).includes(
        reasoningEffort,
      )
    ) {
      onReasoningEffortChange(null);
    }
  };

  return (
    <Flex direction="column" gap="4">
      <Field
        label="Model"
        hint="Default lets PostHog pick the model each run; choose one to pin it."
      >
        <SettingsOptionSelect
          value={model || DEFAULT_MODEL_VALUE}
          options={modelOptions}
          placeholder="Default (recommended)"
          onValueChange={(value) => {
            const nextModel = value === DEFAULT_MODEL_VALUE ? "" : value;
            onModelChange(nextModel);
            clearUnsupportedEffort(adapter, nextModel);
          }}
          disabled={disabled}
          ariaLabel="Model"
        />
      </Field>

      <Flex gap="4" wrap="wrap">
        <Field label="Adapter" className="min-w-[180px] flex-1">
          <SettingsOptionSelect
            value={adapter}
            options={ADAPTER_OPTIONS}
            onValueChange={(value) => {
              const nextAdapter = value as LoopSchemas.LoopRuntimeAdapterEnum;
              onAdapterChange(nextAdapter);
              clearUnsupportedEffort(nextAdapter, model);
            }}
            disabled={disabled}
            ariaLabel="Adapter"
          />
        </Field>

        <Field label="Reasoning effort" className="min-w-[180px] flex-1">
          <SettingsOptionSelect
            value={reasoningEffort ?? AUTO_REASONING_VALUE}
            options={reasoningEffortOptions}
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
