import type { Adapter } from "@posthog/shared";
import { getEffortOptions as getClaudeEffortOptions } from "./claude/session/models";
import { getReasoningEffortOptions as getCodexReasoningEffortOptions } from "./codex-app-server/models";

export type SupportedReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultracode"
  | "ultrathink";

// The cloud task API only accepts the base tiers; ultracode runs the model at
// xhigh and ultrathink at max, so cloud runs clamp to those equivalents.
export type CloudReasoningEffort = Exclude<
  SupportedReasoningEffort,
  "ultracode" | "ultrathink"
>;

export interface ReasoningEffortOption {
  value: SupportedReasoningEffort;
  name: string;
  _meta?: Record<string, unknown>;
}

export function getReasoningEffortOptions(
  adapter: Adapter,
  modelId: string,
): ReasoningEffortOption[] | null {
  const options =
    adapter === "codex"
      ? getCodexReasoningEffortOptions(modelId)
      : getClaudeEffortOptions(modelId);

  return options as ReasoningEffortOption[] | null;
}

export function isSupportedReasoningEffort(
  adapter: Adapter,
  modelId: string,
  value: string,
): value is SupportedReasoningEffort {
  return (
    getReasoningEffortOptions(adapter, modelId)?.some(
      (option) => option.value === value,
    ) ?? false
  );
}

export function isCloudReasoningEffort(
  value: string,
): value is CloudReasoningEffort {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

export function toCloudReasoningEffort(
  value: SupportedReasoningEffort,
): CloudReasoningEffort {
  if (value === "ultracode") return "xhigh";
  if (value === "ultrathink") return "max";
  return value;
}
