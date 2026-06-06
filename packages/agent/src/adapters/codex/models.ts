import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk";

interface ReasoningEffortOption {
  value: string;
  name: string;
}

const CODEX_REASONING_EFFORT_OPTIONS: ReasoningEffortOption[] = [
  { value: "low", name: "Low" },
  { value: "medium", name: "Medium" },
  { value: "high", name: "High" },
];

export function getReasoningEffortOptions(
  _modelId: string,
): ReasoningEffortOption[] {
  return CODEX_REASONING_EFFORT_OPTIONS;
}

export function formatCodexModelName(value: string): string {
  return value.toLowerCase();
}

/** Derive the current model id from the "model" config option's currentValue.
 *  Replaces the legacy `response.models.currentModelId` lookup that ACP SDK
 *  0.25.0 removed (model selection moved entirely into config options). */
export function modelIdFromConfigOptions(
  configOptions: SessionConfigOption[] | null | undefined,
): string | undefined {
  const modelOption = configOptions?.find((o) => o.category === "model");
  return typeof modelOption?.currentValue === "string"
    ? modelOption.currentValue
    : undefined;
}

export function normalizeCodexConfigOptions(
  configOptions: SessionConfigOption[] | null | undefined,
): SessionConfigOption[] | null | undefined {
  if (!configOptions) return configOptions;
  const formatOption = (
    opt: SessionConfigSelectOption,
  ): SessionConfigSelectOption => ({
    ...opt,
    name: formatCodexModelName(opt.value),
  });
  return configOptions.map((option) => {
    if (option.category !== "model" || option.type !== "select") return option;
    const options = option.options;
    if (options.length === 0) return option;
    const isGroup = "group" in options[0];
    return {
      ...option,
      options: isGroup
        ? (options as SessionConfigSelectGroup[]).map((group) => ({
            ...group,
            options: group.options.map(formatOption),
          }))
        : (options as SessionConfigSelectOption[]).map(formatOption),
    } as SessionConfigOption;
  });
}
