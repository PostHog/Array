import {
  type Adapter,
  type AgentSession,
  type CloudRunSource,
  type ExecutionMode,
  getConfigOptionByCategory,
  type PrAuthorshipMode,
} from "@posthog/shared";
import type { TaskRun } from "@posthog/shared/domain-types";

/**
 * Pure derivations of a cloud run's options from the host run state / session
 * config. Extracted from the renderer SessionService so the keystone keeps only
 * the I/O and these decisions are testable in isolation (Tiger-Style: the leaf
 * computes, the service applies).
 */

export function getCloudPrAuthorshipMode(
  state: Record<string, unknown>,
): PrAuthorshipMode {
  const explicitMode = state.pr_authorship_mode;
  if (explicitMode === "user" || explicitMode === "bot") {
    return explicitMode;
  }
  return state.run_source === "signal_report" ? "bot" : "user";
}

export function getCloudRunSource(
  state: Record<string, unknown>,
): CloudRunSource {
  return state.run_source === "signal_report" ? "signal_report" : "manual";
}

export interface CloudRuntimeOptions {
  adapter?: Adapter;
  model?: string;
  reasoningLevel?: string;
  initialPermissionMode?: ExecutionMode;
}

export function getCloudRuntimeOptions(
  session: AgentSession,
  previousRun?: TaskRun,
): CloudRuntimeOptions {
  const modelOption = getConfigOptionByCategory(session.configOptions, "model");
  const thoughtLevelOption = getConfigOptionByCategory(
    session.configOptions,
    "thought_level",
  );
  const modeOption = getConfigOptionByCategory(session.configOptions, "mode");
  const previousMode = previousRun?.state?.initial_permission_mode;

  return {
    adapter: session.adapter ?? previousRun?.runtime_adapter ?? undefined,
    model:
      typeof modelOption?.currentValue === "string"
        ? modelOption.currentValue
        : (previousRun?.model ?? undefined),
    reasoningLevel:
      typeof thoughtLevelOption?.currentValue === "string"
        ? thoughtLevelOption.currentValue
        : (previousRun?.reasoning_effort ?? undefined),
    // Preserve the prior run's approval preset on resume. The session's `mode`
    // config option reflects the user's current selection (seeded from the
    // previous run); fall back to the run state. Without this the resume
    // request omits the mode and the backend reverts to its default ("plan").
    initialPermissionMode:
      typeof modeOption?.currentValue === "string"
        ? (modeOption.currentValue as ExecutionMode)
        : typeof previousMode === "string"
          ? (previousMode as ExecutionMode)
          : undefined,
  };
}
