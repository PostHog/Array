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

const CODEX_ACRONYMS: Record<string, string> = {
  gpt: "GPT",
};

export function formatCodexModelName(value: string): string {
  const normalized = value.replace(/(\d)-(\d)/g, "$1.$2");
  return normalized
    .split("-")
    .map((part) => {
      const lower = part.toLowerCase();
      if (CODEX_ACRONYMS[lower]) return CODEX_ACRONYMS[lower];
      if (/^[0-9.]+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("-");
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
