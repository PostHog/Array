import { getEffortOptions as getClaudeEffortOptions } from "./claude/session/models";
import { getReasoningEffortOptions as getCodexReasoningEffortOptions } from "./codex-app-server/models";

export type RuntimeAdapter = "claude" | "codex";

export type SupportedReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface ReasoningEffortOption {
  value: SupportedReasoningEffort;
  name: string;
}

export function getReasoningEffortOptions(
  adapter: RuntimeAdapter,
  modelId: string,
): ReasoningEffortOption[] | null {
  const options =
    adapter === "codex"
      ? getCodexReasoningEffortOptions(modelId)
      : getClaudeEffortOptions(modelId);

  return options as ReasoningEffortOption[] | null;
}

export function isSupportedReasoningEffort(
  adapter: RuntimeAdapter,
  modelId: string,
  value: string,
): value is SupportedReasoningEffort {
  return (
    getReasoningEffortOptions(adapter, modelId)?.some(
      (option) => option.value === value,
    ) ?? false
  );
}
