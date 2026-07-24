import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { getReasoningEffortOptions } from "@posthog/agent/adapters/reasoning-effort";
import type { LoopSchemas } from "@posthog/api-client/loops";
import { flattenSelectOptions, isRestrictedModelOption } from "@posthog/shared";

export interface LoopModelOption {
  value: string;
  label: string;
}

// Mirrors DEFAULT_MODEL_BY_RUNTIME_ADAPTER in posthog's
// products/tasks/backend/temporal/process_task/utils.py: the model a loop
// fires with when none is pinned, and the one the serializer validates a
// blank-model loop's reasoning effort against.
export const LOOP_DEFAULT_MODELS: Record<
  LoopSchemas.LoopRuntimeAdapterEnum,
  { id: string; label: string }
> = {
  claude: { id: "@cf/zai-org/glm-5.2", label: "GLM-5.2" },
  codex: { id: "gpt-5", label: "GPT-5" },
};

function isGlmModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes("glm");
}

/** The model a loop's runs use, for display: the pinned id, or the adapter's
 * loop default (which differs from the live-session default the
 * ReportModelResolver serves, so it can't be resolved from there). */
export function formatLoopModel(
  adapter: LoopSchemas.LoopRuntimeAdapterEnum,
  configuredModel: string,
): string {
  return configuredModel || `${LOOP_DEFAULT_MODELS[adapter].label} (default)`;
}

/**
 * Pinnable models for a loop, derived from the same per-adapter preview
 * config that feeds the main create-task picker, so the loops picker offers
 * exactly the ids the loops API accepts. Restricted (plan-locked) models are
 * dropped, GLM is flag-gated like the main picker, and the currently pinned
 * model always stays selectable so an existing loop's model never drops out.
 */
export function loopModelOptions(
  configOptions: SessionConfigOption[],
  { glmEnabled, pinnedModel }: { glmEnabled: boolean; pinnedModel: string },
): LoopModelOption[] {
  const modelOption = configOptions.find(
    (option) => option.category === "model" || option.id === "model",
  );
  const served =
    modelOption?.type === "select"
      ? flattenSelectOptions(modelOption.options)
      : [];
  const options = served
    .filter((option) => !isRestrictedModelOption(option._meta))
    .filter(
      (option) =>
        glmEnabled ||
        option.value === pinnedModel ||
        !isGlmModelId(option.value),
    )
    .map((option) => ({
      value: option.value,
      label: option.name ?? option.value,
    }));
  if (pinnedModel && !options.some((option) => option.value === pinnedModel)) {
    options.push({ value: pinnedModel, label: pinnedModel });
  }
  return options;
}

/** Efforts the loops API accepts for the model that would actually run:
 * the pinned model, or the adapter's default when the loop leaves it unset. */
export function loopReasoningEffortOptions(
  adapter: LoopSchemas.LoopRuntimeAdapterEnum,
  model: string,
): { value: LoopSchemas.LoopReasoningEffortEnum; label: string }[] {
  const effectiveModel = model || LOOP_DEFAULT_MODELS[adapter].id;
  const options = getReasoningEffortOptions(adapter, effectiveModel) ?? [];
  return options.map((option) => ({ value: option.value, label: option.name }));
}

/** The effort unchanged when the effective model supports it, else null
 * (auto), so an adapter or model switch never leaves an invalid combo. */
export function clampLoopReasoningEffort(
  adapter: LoopSchemas.LoopRuntimeAdapterEnum,
  model: string,
  effort: LoopSchemas.LoopReasoningEffortEnum | null,
): LoopSchemas.LoopReasoningEffortEnum | null {
  if (effort === null) return null;
  return loopReasoningEffortOptions(adapter, model).some(
    (option) => option.value === effort,
  )
    ? effort
    : null;
}
