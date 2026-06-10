import type { TaskCreationInput } from "@posthog/core/task-detail/taskService";
import {
  type InboxCloudTaskInputContext,
  useInboxCloudTaskRunner,
} from "@posthog/ui/features/inbox/hooks/useInboxCloudTaskRunner";
import { useUserRepositoryIntegration } from "@posthog/ui/features/integrations/useIntegrations";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { useCallback, useMemo } from "react";

// Templated prompts behind the scout chat CTA chips. The agent leans on the
// exploring-signals-scouts skill from the PostHog MCP.
export const SCOUT_FLEET_OVERVIEW_PROMPT = `How is my scout fleet performing?

Use the exploring-signals-scouts skill from the PostHog MCP to survey the signals scout fleet on this project and give me a high-level overview:

- The fleet: which scouts exist, enabled vs disabled, and their cadences
- Recent run health: success rate, failures and timeouts, anything stuck
- Output: which scouts emitted signals recently, emit rate, signal-to-noise
- Memory: notable scratchpad entries the fleet has learned
- Recommendations: anything misconfigured, noisy, or worth tuning

Lead with a short overall verdict, then per-scout notes only where something is notable. If the skill is unavailable, fall back to the signals-scout MCP tools directly (config list, runs list, scratchpad search).`;

export const SCOUT_RECENT_SIGNALS_PROMPT = `What signals have my scouts emitted recently?

Use the exploring-signals-scouts skill from the PostHog MCP to pull the most recent scout runs that emitted findings and walk me through the signals:

- What each signal says, in plain language
- Which scout emitted it, when, and its severity/confidence where available
- Whether it looks genuinely actionable or like noise

Group by scout, newest first. Close with a short note on overall signal quality and any scouts that look noisy or suspiciously silent. If the skill is unavailable, fall back to the signals-scout MCP tools directly (runs list with emitted filter, run emissions).`;

/** Per-scout variant of the templated questions, scoped to one skill. */
export function buildScoutCheckinPrompt(
  skillName: string,
  displayName: string,
): string {
  return `How is my ${displayName} scout performing?

Use the exploring-signals-scouts skill from the PostHog MCP to dig into the \`${skillName}\` scout on this project:

- Its config: enabled, cadence, dry-run posture
- Recent run history: successes, failures, timeouts, durations
- Signals it emitted recently and whether they look genuinely actionable
- Scratchpad memory the fleet holds that relates to this scout
- Whether its scope, thresholds, and schedule look right — suggest tuning if not

Lead with a short verdict. If the skill is unavailable, fall back to the signals-scout MCP tools directly (config list, runs list, run emissions, scratchpad search).`;
}

interface UseScoutChatTaskOptions {
  /** The templated question the task is created with. */
  prompt: string;
  /** Short noun used in toast copy, e.g. "fleet overview". */
  taskLabel: string;
  /** Logger scope used for failure traces. */
  loggerScope: string;
}

interface UseScoutChatTaskReturn {
  /** Create the auto-mode scout chat task and navigate to it on success. */
  runTask: () => Promise<void>;
  /** True while the task is being created. */
  isRunning: boolean;
}

/**
 * One-click scout chat task, mirroring the inbox discuss flow: create an
 * auto-mode cloud task from a templated question and jump straight to it. The
 * repository falls back to the last-used cloud repository, then the first
 * connected one.
 */
export function useScoutChatTask({
  prompt,
  taskLabel,
  loggerScope,
}: UseScoutChatTaskOptions): UseScoutChatTaskReturn {
  const { repositories } = useUserRepositoryIntegration();
  const lastUsedCloudRepository = useSettingsStore(
    (state) => state.lastUsedCloudRepository,
  );

  const cloudRepository = useMemo(() => {
    const normalizedLastUsed = lastUsedCloudRepository?.toLowerCase() ?? null;
    if (normalizedLastUsed && repositories.includes(normalizedLastUsed)) {
      return normalizedLastUsed;
    }
    return repositories[0] ?? null;
  }, [lastUsedCloudRepository, repositories]);

  const buildInput = useCallback(
    (ctx: InboxCloudTaskInputContext): TaskCreationInput => ({
      content: prompt,
      taskDescription: prompt,
      repository: ctx.cloudRepository,
      githubUserIntegrationId: ctx.githubUserIntegrationId,
      workspaceMode: "cloud",
      executionMode: "auto",
      adapter: ctx.adapter,
      model: ctx.model,
      reasoningLevel: ctx.reasoningLevel,
    }),
    [prompt],
  );

  const copy = useMemo(
    () => ({
      loadingTitle: `Starting ${taskLabel}...`,
      errorTitle: `Failed to start ${taskLabel}`,
      missingRepository: `Connect a GitHub repository before starting a ${taskLabel}`,
      missingIntegration: `Connect a GitHub integration to start a ${taskLabel}`,
      signedOut: `Sign in to start a ${taskLabel}`,
      missingModel:
        "Couldn't resolve a default model. Open the task page once and pick a model, then try again.",
    }),
    [taskLabel],
  );

  const { run, isRunning } = useInboxCloudTaskRunner({
    cloudRepository,
    loggerScope,
    copy,
    buildInput,
  });

  return { runTask: run, isRunning };
}
